/**
 * Master Playlist Processor
 * Processes master playlist generation jobs using Bull
 */
import Bull from 'bull';
import { PrismaClient } from '@prisma/client';
import { TranscodingService } from '../services/TranscodingService';
import { MasterPlaylistJobData } from '../config/bull';

export class MasterPlaylistProcessor {
   private prisma: PrismaClient;
   private transcodingService: TranscodingService;

   constructor(prisma: PrismaClient) {
      this.prisma = prisma;
      this.transcodingService = new TranscodingService(prisma);
   }

   /**
    * Process master playlist generation job
    */
   public async processMasterPlaylist(job: Bull.Job<MasterPlaylistJobData>): Promise<void> {
      const { chapterId, variantBitrates } = job.data;

      console.log(`Processing master playlist generation for chapter ${chapterId}`);

      try {
         // Update job progress
         await job.progress(10);

         // Wait for bitrate jobs to complete and check which ones succeeded
         const completedBitrates = await this.waitForBitrateJobs(chapterId, variantBitrates);

         if (completedBitrates.length === 0) {
            throw new Error('No bitrate transcoding jobs completed successfully');
         }

         // Update job progress
         await job.progress(30);

         // Generate master playlist for completed bitrates
         const masterPlaylist = await this.generateMasterPlaylistForBitrates(chapterId, completedBitrates);

         // Update job progress
         await job.progress(70);

         // Upload master playlist to storage
         await this.uploadMasterPlaylist(chapterId, masterPlaylist);

         // Update job progress
         await job.progress(100);

         console.log(`Successfully completed master playlist generation for chapter ${chapterId}`);

      } catch (error: any) {
         console.error(`Master playlist generation failed for chapter ${chapterId}:`, error);

         // Update database with error
         await this.updateTranscodingJob(chapterId, 'failed', 0, error.message);

         throw error; // Re-throw to mark job as failed
      }
   }

   /**
    * Wait for bitrate jobs to complete and return successful ones
    */
   private async waitForBitrateJobs(chapterId: string, expectedBitrates: number[]): Promise<number[]> {
      const maxWaitTime = 30 * 60 * 1000; // 30 minutes
      const checkInterval = 5000; // 5 seconds
      const startTime = Date.now();

      console.log(`Waiting for bitrate jobs to complete for chapter ${chapterId}`);

      while (Date.now() - startTime < maxWaitTime) {
         // Check which bitrates have completed successfully
         const completedTranscoded = await this.prisma.transcodedChapter.findMany({
            where: {
               chapterId,
               bitrate: { in: expectedBitrates },
               status: 'completed'
            },
            select: { bitrate: true }
         });

         const completedBitrates = completedTranscoded.map(tc => tc.bitrate);

         if (completedBitrates.length > 0) {
            console.log(`Found ${completedBitrates.length} completed bitrates for chapter ${chapterId}: ${completedBitrates.join(', ')}`);
            return completedBitrates;
         }

         // Wait before checking again
         await new Promise(resolve => setTimeout(resolve, checkInterval));
      }

      console.warn(`Timeout waiting for bitrate jobs for chapter ${chapterId}`);
      return [];
   }

   /**
    * Generate master playlist for specific bitrates
    */
   private async generateMasterPlaylistForBitrates(chapterId: string, bitrates: number[]): Promise<string> {
      try {
         // Get transcoded chapter info for each bitrate
         const transcodedChapters = await this.prisma.transcodedChapter.findMany({
            where: {
               chapterId,
               bitrate: { in: bitrates },
               status: 'completed'
            }
         });

         if (transcodedChapters.length === 0) {
            throw new Error('No completed transcoded chapters found');
         }

         // Create variant playlists data structure
         const variantPlaylists = transcodedChapters.map(tc => ({
            bitrate: tc.bitrate,
            playlist: '', // We don't need the actual playlist content for master generation
            segments: [] // We don't need segments for master generation
         }));

         // Generate master playlist using TranscodingService
         const masterPlaylist = this.transcodingService.generateMasterPlaylist(variantPlaylists, '');

         return masterPlaylist;
      } catch (error: any) {
         console.error('Error generating master playlist:', error);
         throw error;
      }
   }

   /**
    * Upload master playlist to storage
    */
   private async uploadMasterPlaylist(chapterId: string, masterPlaylist: string): Promise<void> {
      try {
         // Initialize storage provider
         await this.transcodingService['initializeStorageProvider']();

         // Upload master playlist to bit_transcode/{chapter_id} directory
         const masterPlaylistPath = `bit_transcode/${chapterId}/master.m3u8`;
         await this.transcodingService['storageProvider']!.uploadFile(
            masterPlaylistPath,
            Buffer.from(masterPlaylist),
            'application/vnd.apple.mpegurl'
         );

         console.log(`Master playlist uploaded for chapter ${chapterId}`);
      } catch (error: any) {
         console.error('Error uploading master playlist:', error);
         throw error;
      }
   }

   /**
    * Update transcoding job in database
    */
   private async updateTranscodingJob(
      chapterId: string,
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
