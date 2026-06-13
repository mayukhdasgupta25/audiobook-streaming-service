/**
 * Bitrate Transcoding Processor
 * Processes individual bitrate transcoding jobs using Bull
 */
import Bull from 'bull';
import { PrismaClient } from '@prisma/client';
import { TranscodingService } from '../services/TranscodingService';
import { BitrateTranscodingJobData } from '../config/bull';
import { TranscodingEventPublisher } from '../services/TranscodingEventPublisher';
import { BitrateTranscodingRepository } from '../services/BitrateTranscodingRepository';
import { bullLogger } from '../config/logger';

export class BitrateTranscodingProcessor {
   private prisma: PrismaClient;
   private transcodingService: TranscodingService;
   private readonly eventPublisher: TranscodingEventPublisher;
   private readonly bitrateRepo: BitrateTranscodingRepository;

   constructor(prisma: PrismaClient) {
      this.prisma = prisma;
      this.transcodingService = new TranscodingService(prisma);
      this.eventPublisher = TranscodingEventPublisher.getInstance();
      this.bitrateRepo = new BitrateTranscodingRepository(prisma);
   }

   public async processBitrateTranscoding(job: Bull.Job<BitrateTranscodingJobData>): Promise<void> {
      const { chapterId, inputPath, outputDir, bitrate, segmentDuration, userId } = job.data;

      bullLogger.info({ chapterId, bitrate }, 'Processing bitrate transcoding job for chapter');

      try {
         await job.progress(10);

         const existingTranscoded = await this.prisma.transcodedChapter.findUnique({
            where: { chapterId_bitrate: { chapterId, bitrate } },
         });

         if (existingTranscoded?.status === 'completed' && existingTranscoded.storageCommitted) {
            bullLogger.info({ chapterId, bitrate }, 'Chapter already transcoded for bitrate');
            await job.progress(100);
            return;
         }

         await this.bitrateRepo.upsertPending(chapterId, [bitrate]);
         await this.eventPublisher.publishStatusTransition(chapterId, bitrate, 'pending', 0);

         await job.progress(20);

         await this.transcodingService.transcodeSingleBitrate({
            inputPath,
            outputDir,
            bitrate,
            segmentDuration,
            id: chapterId,
            ...(userId && { userId }),
         });

         await job.progress(100);
         bullLogger.info({ chapterId, bitrate }, 'Successfully completed bitrate transcoding for chapter');
      } catch (error: unknown) {
         const message = error instanceof Error ? error.message : 'Unknown error';
         bullLogger.error({ err: error, chapterId, bitrate }, 'Bitrate transcoding failed for chapter');
         await this.bitrateRepo.markFailed(chapterId, bitrate, 0, message);
         await this.eventPublisher.publishStatusTransition(chapterId, bitrate, 'failed', 0, message);
         throw error;
      }
   }
}
