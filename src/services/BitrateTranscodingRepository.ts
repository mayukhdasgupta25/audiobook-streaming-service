/**
 * Bitrate Transcoding Repository
 * DB helpers with transaction support for per-bitrate transcoding state
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { config } from '../config/env';
import { toStorageKey } from '../utils/storageKeys';
import { BitrateTranscodingState } from '../types/transcoding';

export interface UpsertBitrateParams {
   chapterId: string;
   bitrate: number;
   status: BitrateTranscodingState;
   progress?: number;
   playlistUrl?: string;
   segmentsPath?: string;
   storageProvider?: string;
   storageCommitted?: boolean;
   errorMessage?: string | null;
}

export class BitrateTranscodingRepository {
   constructor(private readonly prisma: PrismaClient) {}

   async upsertPending(chapterId: string, bitrates: number[]): Promise<void> {
      await this.prisma.$transaction(
         bitrates.map(bitrate =>
            this.prisma.transcodedChapter.upsert({
               where: { chapterId_bitrate: { chapterId, bitrate } },
               update: {
                  status: 'pending',
                  progress: 0,
                  errorMessage: null,
                  storageCommitted: false,
                  updatedAt: new Date(),
               },
               create: {
                  chapterId,
                  bitrate,
                  status: 'pending',
                  progress: 0,
                  playlistUrl: '',
                  segmentsPath: '',
                  storageProvider: 'local',
                  storageCommitted: false,
               },
            })
         )
      );
   }

   async updateProgress(
      chapterId: string,
      bitrate: number,
      progress: number
   ): Promise<void> {
      await this.prisma.transcodedChapter.update({
         where: { chapterId_bitrate: { chapterId, bitrate } },
         data: { progress, updatedAt: new Date() },
      });
   }

   async markProcessing(chapterId: string, bitrate: number): Promise<void> {
      await this.prisma.transcodedChapter.upsert({
         where: { chapterId_bitrate: { chapterId, bitrate } },
         update: {
            status: 'processing',
            progress: 0,
            errorMessage: null,
            updatedAt: new Date(),
         },
         create: {
            chapterId,
            bitrate,
            status: 'processing',
            progress: 0,
            playlistUrl: '',
            segmentsPath: '',
            storageProvider: 'local',
            storageCommitted: false,
         },
      });
   }

   async commitCompletedLocal(
      chapterId: string,
      bitrate: number
   ): Promise<{ playlistUrl: string; segmentsPath: string }> {
      const playlistUrl = toStorageKey(`bit_transcode/${chapterId}/${bitrate}k/playlist.m3u8`);
      const segmentsPath = toStorageKey(`bit_transcode/${chapterId}/${bitrate}k/`);

      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
         await tx.transcodedChapter.upsert({
            where: { chapterId_bitrate: { chapterId, bitrate } },
            update: {
               playlistUrl,
               segmentsPath,
               status: 'completed',
               progress: 100,
               storageProvider: 'local',
               storageCommitted: true,
               errorMessage: null,
               updatedAt: new Date(),
            },
            create: {
               chapterId,
               bitrate,
               playlistUrl,
               segmentsPath,
               status: 'completed',
               progress: 100,
               storageProvider: 'local',
               storageCommitted: true,
            },
         });
      });

      return { playlistUrl, segmentsPath };
   }

   async markStoredOnS3(chapterId: string, bitrate: number): Promise<void> {
      await this.prisma.transcodedChapter.update({
         where: { chapterId_bitrate: { chapterId, bitrate } },
         data: {
            storageProvider: config.STORAGE_PROVIDER,
            updatedAt: new Date(),
         },
      });
   }

   async markFailed(
      chapterId: string,
      bitrate: number,
      progress: number,
      errorMessage: string
   ): Promise<void> {
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
         await tx.transcodedChapter.upsert({
            where: { chapterId_bitrate: { chapterId, bitrate } },
            update: {
               status: 'failed',
               progress,
               errorMessage,
               updatedAt: new Date(),
            },
            create: {
               chapterId,
               bitrate,
               status: 'failed',
               progress,
               errorMessage,
               playlistUrl: '',
               segmentsPath: '',
               storageProvider: 'local',
               storageCommitted: false,
            },
         });
      });
   }

   async resetForRetry(chapterId: string, bitrates: number[]): Promise<void> {
      await this.prisma.$transaction(
         bitrates.map(bitrate =>
            this.prisma.transcodedChapter.upsert({
               where: { chapterId_bitrate: { chapterId, bitrate } },
               update: {
                  status: 'pending',
                  progress: 0,
                  errorMessage: null,
                  storageCommitted: false,
                  updatedAt: new Date(),
               },
               create: {
                  chapterId,
                  bitrate,
                  status: 'pending',
                  progress: 0,
                  playlistUrl: '',
                  segmentsPath: '',
                  storageProvider: 'local',
                  storageCommitted: false,
               },
            })
         )
      );
   }

   async resetAllForRetranscode(chapterId: string, bitrates: number[]): Promise<void> {
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
         await tx.transcodedChapter.deleteMany({ where: { chapterId } });
         for (const bitrate of bitrates) {
            await tx.transcodedChapter.create({
               data: {
                  chapterId,
                  bitrate,
                  status: 'pending',
                  progress: 0,
                  playlistUrl: '',
                  segmentsPath: '',
                  storageProvider: 'local',
                  storageCommitted: false,
               },
            });
         }
         const existingJob = await tx.transcodingJob.findFirst({
            where: { chapterId },
            orderBy: { createdAt: 'desc' },
         });
         if (existingJob) {
            await tx.transcodingJob.update({
               where: { id: existingJob.id },
               data: {
                  status: 'processing',
                  progress: 0,
                  errorMessage: null,
                  startedAt: new Date(),
                  completedAt: null,
                  updatedAt: new Date(),
               },
            });
         } else {
            await tx.transcodingJob.create({
               data: {
                  chapterId,
                  status: 'processing',
                  progress: 0,
                  startedAt: new Date(),
               },
            });
         }
      });
   }

   async getBitrateRows(chapterId: string) {
      return this.prisma.transcodedChapter.findMany({
         where: { chapterId },
         orderBy: { bitrate: 'asc' },
      });
   }

   async allBitratesCompleted(chapterId: string, expectedBitrates: number[]): Promise<boolean> {
      const rows = await this.prisma.transcodedChapter.findMany({
         where: { chapterId, status: 'completed' },
         select: { bitrate: true },
      });
      const completed = new Set(rows.map(r => r.bitrate));
      return expectedBitrates.every(b => completed.has(b));
   }
}
