/**
 * Master Playlist Processor
 * Processes master playlist generation jobs using Bull
 */
import Bull from 'bull';
import { PrismaClient } from '@prisma/client';
import { TranscodingService } from '../services/TranscodingService';
import { DASHStreamingService } from '../services/DASHStreamingService';
import { MasterPlaylistJobData } from '../config/bull';

export class MasterPlaylistProcessor {
   private prisma: PrismaClient;
   private transcodingService: TranscodingService;
   private dashStreamingService: DASHStreamingService;

   constructor(prisma: PrismaClient) {
      this.prisma = prisma;
      this.transcodingService = new TranscodingService(prisma);
      this.dashStreamingService = new DASHStreamingService(prisma);
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

         // Generate HLS master playlist for completed bitrates
         const masterPlaylist = await this.generateMasterPlaylistForBitrates(chapterId, completedBitrates);

         // Update job progress
         await job.progress(50);

         // Generate DASH manifest for completed bitrates
         const dashManifest = await this.generateDASHManifestForBitrates(chapterId, completedBitrates);

         // Update job progress
         await job.progress(70);

         // Upload HLS master playlist to storage
         await this.uploadMasterPlaylist(chapterId, masterPlaylist);

         // Upload DASH manifest to storage
         await this.uploadDASHManifest(chapterId, dashManifest);

         // Update job progress
         await job.progress(100);

         console.log(`Successfully completed master playlist and DASH manifest generation for chapter ${chapterId}`);

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

      console.log(`Waiting for bitrate jobs to complete for chapter ${chapterId}, expected: ${expectedBitrates.join(', ')}`);

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

         // Wait for ALL expected bitrates to complete, or return what we have after timeout
         if (completedBitrates.length === expectedBitrates.length) {
            console.log(`All ${completedBitrates.length} expected bitrates completed for chapter ${chapterId}: ${completedBitrates.join(', ')}`);
            return completedBitrates;
         }

         if (completedBitrates.length > 0) {
            console.log(`Found ${completedBitrates.length}/${expectedBitrates.length} completed bitrates for chapter ${chapterId}: ${completedBitrates.join(', ')}. Waiting for more...`);
         }

         // Wait before checking again
         await new Promise(resolve => setTimeout(resolve, checkInterval));
      }

      // After timeout, return whatever bitrates have completed
      const finalCompleted = await this.prisma.transcodedChapter.findMany({
         where: {
            chapterId,
            bitrate: { in: expectedBitrates },
            status: 'completed'
         },
         select: { bitrate: true }
      });

      const finalBitrates = finalCompleted.map(tc => tc.bitrate);

      if (finalBitrates.length > 0) {
         console.warn(`Timeout waiting for all bitrate jobs for chapter ${chapterId}. Returning ${finalBitrates.length} completed bitrates: ${finalBitrates.join(', ')}`);
         return finalBitrates;
      }

      console.warn(`Timeout waiting for bitrate jobs for chapter ${chapterId}, no bitrates completed`);
      return [];
   }

   /**
    * Generate master playlist for specific bitrates
    */
   private async generateMasterPlaylistForBitrates(chapterId: string, bitrates: number[]): Promise<string> {
      try {
         // Get ALL completed transcoded chapters for this chapter (not just the ones passed in)
         // This ensures we include any bitrates that completed after the initial check
         const transcodedChapters = await this.prisma.transcodedChapter.findMany({
            where: {
               chapterId,
               status: 'completed'
            },
            orderBy: {
               bitrate: 'asc'
            }
         });

         if (transcodedChapters.length === 0) {
            throw new Error('No completed transcoded chapters found');
         }

         console.log(`Generating master playlist for chapter ${chapterId} with ${transcodedChapters.length} completed bitrates: ${transcodedChapters.map(tc => tc.bitrate).join(', ')}`);

         // Create variant playlists data structure
         const variantPlaylists = transcodedChapters.map(tc => ({
            bitrate: tc.bitrate,
            playlist: '', // We don't need the actual playlist content for master generation
            segments: [] // We don't need segments for master generation
         }));

         // Generate master playlist using TranscodingService
         const masterPlaylist = this.transcodingService.generateMasterPlaylist(variantPlaylists, chapterId);

         return masterPlaylist;
      } catch (error: any) {
         console.error('Error generating master playlist:', error);
         throw error;
      }
   }

   /**
    * Generate DASH manifest for specific bitrates
    */
   private async generateDASHManifestForBitrates(chapterId: string, bitrates: number[]): Promise<string> {
      try {
         // Get available bitrates info
         const availableBitrates = await this.dashStreamingService.getAvailableBitrates(chapterId);
         const filteredBitrates = availableBitrates.filter(b => bitrates.includes(b));

         if (filteredBitrates.length === 0) {
            throw new Error('No completed transcoded chapters found for DASH manifest');
         }

         // Generate DASH manifest using DASHStreamingService
         const manifestInfo = await this.dashStreamingService.generateDASHManifest(
            chapterId,
            filteredBitrates,
            undefined,
            undefined
         );

         return manifestInfo.manifest;
      } catch (error: any) {
         console.error('Error generating DASH manifest:', error);
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
    * Upload DASH manifest to storage
    */
   private async uploadDASHManifest(chapterId: string, dashManifest: string): Promise<void> {
      try {
         // Initialize storage provider
         await this.transcodingService['initializeStorageProvider']();

         // Upload DASH manifest to bit_transcode/{chapter_id} directory
         const dashManifestPath = `bit_transcode/${chapterId}/manifest.mpd`;
         await this.transcodingService['storageProvider']!.uploadFile(
            dashManifestPath,
            Buffer.from(dashManifest),
            'application/dash+xml'
         );

         console.log(`DASH manifest uploaded for chapter ${chapterId}`);
      } catch (error: any) {
         console.error('Error uploading DASH manifest:', error);
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
