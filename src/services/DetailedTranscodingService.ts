/**
 * Detailed Transcoding Status Service
 * Aggregates per-bitrate transcoding state for REST and SSE snapshots
 */
import { PrismaClient } from '@prisma/client';
import { config } from '../config/env';
import { StorageFactory } from './storage/StorageFactory';
import { toStorageKey } from '../utils/storageKeys';
import {
   AggregateTranscodingStatus,
   BitrateStatusDetail,
   BitrateTranscodingState,
   ChapterTranscodingStatusDetail,
} from '../types/transcoding';

export class DetailedTranscodingService {
   constructor(private readonly prisma: PrismaClient) {}

   async getDetailedStatus(chapterId: string): Promise<ChapterTranscodingStatusDetail> {
      const expectedBitrates = config.TRANSCODING_BITRATES;
      const rows = await this.prisma.transcodedChapter.findMany({
         where: { chapterId },
         orderBy: { bitrate: 'asc' },
      });

      const rowByBitrate = new Map(rows.map(r => [r.bitrate, r]));

      const bitrates: BitrateStatusDetail[] = expectedBitrates.map(bitrate => {
         const row = rowByBitrate.get(bitrate);
         if (!row) {
            return { bitrate, status: 'pending' as BitrateTranscodingState, progress: 0 };
         }
         return {
            bitrate,
            status: row.status as BitrateTranscodingState,
            progress: row.progress ?? 0,
            ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
         };
      });

      const completedCount = bitrates.filter(b => b.status === 'completed').length;
      const failedCount = bitrates.filter(b => b.status === 'failed').length;
      const inFlightCount = bitrates.filter(
         b => b.status === 'pending' || b.status === 'processing'
      ).length;

      let aggregateStatus: AggregateTranscodingStatus = 'not_started';
      if (completedCount === expectedBitrates.length) {
         aggregateStatus = 'completed';
      } else if (failedCount === expectedBitrates.length) {
         aggregateStatus = 'failed';
      } else if (completedCount > 0 && (failedCount > 0 || inFlightCount > 0)) {
         aggregateStatus = 'partial';
      } else if (inFlightCount > 0 || rows.some(r => r.status === 'processing')) {
         aggregateStatus = 'processing';
      } else if (failedCount > 0) {
         aggregateStatus = 'partial';
      }

      const masterPlaylistReady = await this.isMasterPlaylistReady(chapterId);
      const canStream = completedCount > 0 && masterPlaylistReady;

      return {
         chapterId,
         canStream,
         masterPlaylistReady,
         aggregateStatus,
         bitrates,
      };
   }

   private async isMasterPlaylistReady(chapterId: string): Promise<boolean> {
      try {
         await StorageFactory.initialize();
         const storage = StorageFactory.getStorageProvider();
         const key = toStorageKey(`bit_transcode/${chapterId}/master.m3u8`);
         return storage.fileExists(key);
      } catch {
         return false;
      }
   }

   async getFailedBitrates(chapterId: string, bitrates?: number[]): Promise<number[]> {
      const rows = await this.prisma.transcodedChapter.findMany({
         where: {
            chapterId,
            status: 'failed',
            ...(bitrates?.length ? { bitrate: { in: bitrates } } : {}),
         },
         select: { bitrate: true },
      });
      return rows.map(r => r.bitrate);
   }
}
