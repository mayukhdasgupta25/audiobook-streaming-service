/**
 * Transcoding Retry Service
 * Re-queues failed bitrates for transcoding
 */
import { PrismaClient } from '@prisma/client';
import { config } from '../config/env';
import { BullQueueManager } from './BullQueueManager';
import { BitrateTranscodingRepository } from './BitrateTranscodingRepository';
import { TranscodingEventPublisher } from './TranscodingEventPublisher';
import { DetailedTranscodingService } from './DetailedTranscodingService';
import { logger } from '../config/logger';

export interface RetryTranscodingInput {
   chapterId: string;
   bitrates?: number[];
   inputPath: string;
   userId?: string;
}

export class TranscodingRetryService {
   private readonly bitrateRepo: BitrateTranscodingRepository;
   private readonly eventPublisher: TranscodingEventPublisher;
   private readonly detailService: DetailedTranscodingService;

   constructor(
      private readonly prisma: PrismaClient,
      private readonly bullQueueManager: BullQueueManager
   ) {
      this.bitrateRepo = new BitrateTranscodingRepository(prisma);
      this.eventPublisher = TranscodingEventPublisher.getInstance();
      this.detailService = new DetailedTranscodingService(prisma);
   }

   async retryFailedBitrates(input: RetryTranscodingInput): Promise<{ retriedBitrates: number[] }> {
      const { chapterId, inputPath, userId } = input;
      let targetBitrates = input.bitrates;

      if (!targetBitrates?.length) {
         targetBitrates = await this.detailService.getFailedBitrates(chapterId);
      }

      if (!targetBitrates.length) {
         return { retriedBitrates: [] };
      }

      const rows = await this.prisma.transcodedChapter.findMany({
         where: { chapterId, bitrate: { in: targetBitrates } },
      });
      const retriable = targetBitrates.filter(bitrate => {
         const row = rows.find(r => r.bitrate === bitrate);
         return !row || row.status === 'failed' || row.status === 'pending';
      });

      if (!retriable.length) {
         return { retriedBitrates: [] };
      }

      await this.bitrateRepo.resetForRetry(chapterId, retriable);
      for (const bitrate of retriable) {
         await this.eventPublisher.publishStatusTransition(chapterId, bitrate, 'pending', 0);
      }

      const outputDir = `bit_transcode/${chapterId}`;
      for (const bitrate of retriable) {
         await this.bullQueueManager.addBitrateTranscodingJob(
            {
               chapterId,
               inputPath,
               outputDir,
               bitrate,
               segmentDuration: config.HLS_SEGMENT_DURATION,
               ...(userId && { userId }),
            },
            'normal'
         );
      }

      await this.bullQueueManager.addMasterPlaylistJob(
         {
            chapterId,
            outputDir,
            variantBitrates: retriable,
         },
         'normal'
      );

      logger.info({ chapterId, retriable }, 'Retried failed bitrates for chapter');
      return { retriedBitrates: retriable };
   }
}
