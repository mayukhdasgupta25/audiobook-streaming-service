/**
 * Bitrate Transcoding Processor
 * Processes individual bitrate transcoding jobs using Bull
 */
import Bull from 'bull';
import { PrismaClient } from '@prisma/client';
import { TranscodingService } from '../services/TranscodingService';
import { BitrateTranscodingJobData } from '../config/bull';
import { config } from '../config/env';

export class BitrateTranscodingProcessor {
   private prisma: PrismaClient;
   private transcodingService: TranscodingService;

   constructor(prisma: PrismaClient) {
      this.prisma = prisma;
      this.transcodingService = new TranscodingService(prisma);
   }

   /**
    * Process bitrate transcoding job
    */
   public async processBitrateTranscoding(job: Bull.Job<BitrateTranscodingJobData>): Promise<void> {
      const { chapterId, inputPath, outputDir, bitrate, segmentDuration, userId } = job.data;

      console.log(`Processing bitrate transcoding job for chapter ${chapterId}, bitrate ${bitrate}k`);

      try {
         // Update job progress
         await job.progress(10);

         // Check if already transcoded
         const existingTranscoded = await this.prisma.transcodedChapter.findUnique({
            where: {
               chapterId_bitrate: {
                  chapterId,
                  bitrate
               }
            }
         });

         if (existingTranscoded && existingTranscoded.status === 'completed') {
            console.log(`Chapter ${chapterId} already transcoded for bitrate ${bitrate}k`);
            await job.progress(100);
            return;
         }

         // Update job progress
         await job.progress(20);

         // Transcode single bitrate
         const result = await this.transcodingService.transcodeSingleBitrate({
            inputPath,
            outputDir,
            bitrate,
            segmentDuration,
            id: chapterId,
            ...(userId && { userId })
         });

         // Update job progress
         await job.progress(80);

         // Update database with transcoded chapter info
         await this.updateTranscodedChapter(chapterId, bitrate, result);

         // Update job progress
         await job.progress(100);

         console.log(`Successfully completed bitrate transcoding for chapter ${chapterId}, bitrate ${bitrate}k`);

      } catch (error: any) {
         console.error(`Bitrate transcoding failed for chapter ${chapterId}, bitrate ${bitrate}k:`, error);

         // Update database with error
         await this.updateTranscodingJob(chapterId, bitrate, 'failed', 0, error.message);

         throw error; // Re-throw to mark job as failed
      }
   }

   /**
    * Update transcoded chapter in database
    */
   private async updateTranscodedChapter(
      chapterId: string,
      bitrate: number,
      _result: { bitrate: number; playlist: string; segments: string[] }
   ): Promise<void> {
      try {
         const playlistUrl = `bit_transcode/${chapterId}/${bitrate}k/playlist.m3u8`;
         const segmentsPath = `bit_transcode/${chapterId}/${bitrate}k/`;

         await this.prisma.transcodedChapter.upsert({
            where: {
               chapterId_bitrate: {
                  chapterId,
                  bitrate
               }
            },
            update: {
               playlistUrl,
               segmentsPath,
               status: 'completed',
               updatedAt: new Date()
            },
            create: {
               chapterId,
               bitrate,
               playlistUrl,
               segmentsPath,
               storageProvider: config.STORAGE_PROVIDER,
               status: 'completed'
            }
         });

         console.log(`Updated transcoded chapter record for chapter ${chapterId}, bitrate ${bitrate}k`);
      } catch (error: any) {
         console.error('Error updating transcoded chapter:', error);
         throw error;
      }
   }

   /**
    * Update transcoding job in database
    */
   private async updateTranscodingJob(
      chapterId: string,
      bitrate: number,
      status: string,
      progress: number,
      errorMessage?: string
   ): Promise<void> {
      try {
         // Find the most recent job for this chapter
         const existingJob = await this.prisma.transcodingJob.findFirst({
            where: { chapterId },
            orderBy: { createdAt: 'desc' }
         });

         if (existingJob) {
            await this.prisma.transcodingJob.update({
               where: { id: existingJob.id },
               data: {
                  status,
                  progress,
                  ...(errorMessage && { errorMessage }),
                  ...(status === 'processing' && !existingJob.startedAt && { startedAt: new Date() }),
                  ...((status === 'completed' || status === 'failed') && { completedAt: new Date() }),
                  updatedAt: new Date()
               }
            });
         } else {
            // Create new job if none exists
            await this.prisma.transcodingJob.create({
               data: {
                  chapterId,
                  status,
                  progress,
                  ...(errorMessage && { errorMessage }),
                  ...(status === 'processing' && { startedAt: new Date() }),
                  ...((status === 'completed' || status === 'failed') && { completedAt: new Date() })
               }
            });
         }
      } catch (error: any) {
         console.error('Error updating transcoding job:', error);
      }
   }
}
