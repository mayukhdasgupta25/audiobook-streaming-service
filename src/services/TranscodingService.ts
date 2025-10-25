/**
 * Audio Transcoding Service
 * Handles audio transcoding to multiple bitrates for HLS streaming
 */
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs/promises';
import { StorageProvider } from './storage/StorageProvider';
import { StorageFactory } from './storage/StorageFactory';
import { config } from '../config/env';
import { PrismaClient } from '@prisma/client';

export interface TranscodingOptions {
   inputPath: string;
   outputDir: string;
   bitrates: number[];
   segmentDuration: number;
   id: string;
   userId?: string;
}

export interface TranscodingProgress {
   id: string;
   bitrate: number;
   progress: number;
   status: 'pending' | 'processing' | 'completed' | 'failed';
   errorMessage?: string;
}

export interface HLSPlaylist {
   masterPlaylist: string;
   variantPlaylists: Array<{
      bitrate: number;
      playlist: string;
      segments: string[];
   }>;
}

export class TranscodingService {
   private prisma: PrismaClient;
   private storageProvider: StorageProvider | null = null;

   constructor(prisma: PrismaClient) {
      this.prisma = prisma;
      // Storage provider will be initialized when needed
   }

   /**
    * Initialize storage provider
    */
   private async initializeStorageProvider(): Promise<void> {
      if (!this.storageProvider) {
         await StorageFactory.initialize();
         this.storageProvider = StorageFactory.getStorageProvider();
      }
   }

   /**
    * Ensure input file exists at specified path
    * In development: store in local directory at filePath
    * In other environments: ensure file exists in S3 at filePath
    */
   private async ensureInputFileExists(filePath: string): Promise<void> {
      await this.initializeStorageProvider();

      // In development, ensure file exists in local storage
      if (config.NODE_ENV === 'development') {
         const fullPath = path.join(process.cwd(), "storage", filePath);
         const dirPath = path.dirname(fullPath);

         // Create directory if it doesn't exist
         await fs.mkdir(dirPath, { recursive: true });

         // Check if file exists locally
         try {
            await fs.access(fullPath);
            console.log(`File already exists at: ${fullPath}`);
         } catch {
            // File doesn't exist locally, try to get it from storage provider
            console.log(`File not found locally, downloading from storage: ${filePath}`);
            const fileExists = await this.storageProvider!.fileExists(filePath);

            if (!fileExists) {
               throw new Error(`Input file not found in storage at path: ${filePath}`);
            }

            const fileContent = await this.storageProvider!.downloadFile(filePath);
            await fs.writeFile(fullPath, fileContent);
            console.log(`File downloaded and saved to: ${fullPath}`);
         }
      } else {
         // For production/other environments, verify file exists in storage (S3)
         const fileExists = await this.storageProvider!.fileExists(filePath);

         if (!fileExists) {
            throw new Error(`Input file not found in storage at path: ${filePath}`);
         }

         console.log(`File verified in storage: ${filePath}`);
      }
   }

   /**
    * Transcode audio file to multiple bitrates for HLS streaming
    */
   async transcodeChapter(options: TranscodingOptions): Promise<HLSPlaylist> {
      const { inputPath, outputDir, bitrates, segmentDuration, id, userId } = options;

      try {
         // Initialize storage provider
         await this.initializeStorageProvider();

         // Ensure input file exists and download to temp location
         await this.ensureInputFileExists(inputPath);
         const tempInputPath = await this.downloadToTemp(inputPath);

         // Create output directory structure
         await this.ensureOutputDirectory(outputDir);

         const variantPlaylists: Array<{
            bitrate: number;
            playlist: string;
            segments: string[];
         }> = [];

         // Transcode to each bitrate
         for (const bitrate of bitrates) {
            try {
               console.log(`Starting transcoding for bitrate ${bitrate}k for chapter ${id}`);

               const result = await this.transcodeToBitrate({
                  inputPath: tempInputPath,
                  outputDir,
                  bitrate,
                  segmentDuration,
                  id,
                  ...(userId && { userId })
               });

               variantPlaylists.push(result);
               console.log(`Successfully completed transcoding for bitrate ${bitrate}k`);

               // Update database with transcoded chapter info
               await this.updateTranscodedChapter(id, bitrate, result);

            } catch (error: any) {
               console.error(`Failed to transcode bitrate ${bitrate}k for chapter ${id}:`, {
                  error: error.message,
                  stack: error.stack,
                  bitrate,
                  chapterId: id
               });

               // Update database with error
               await this.updateTranscodingJob(id, bitrate, 'failed', 0, error.message);

               // Continue with other bitrates
               continue;
            }
         }

         // Generate master playlist
         const masterPlaylist = this.generateMasterPlaylist(variantPlaylists, outputDir);

         // Upload master playlist to bit_transcode/{chapter_id} directory
         const masterPlaylistPath = `bit_transcode/${id}/master.m3u8`;
         await this.storageProvider!.uploadFile(
            masterPlaylistPath,
            Buffer.from(masterPlaylist),
            'application/vnd.apple.mpegurl'
         );

         // Clean up temporary input file immediately after all transcoding is complete
         await this.cleanupTempFiles(tempInputPath);

         return {
            masterPlaylist,
            variantPlaylists
         };

      } catch (error: any) {
         console.error('Transcoding failed:', error);
         throw new Error(`Transcoding failed: ${error.message}`);
      }
   }

   /**
    * Transcode audio to a single bitrate (for Bull jobs)
    */
   async transcodeSingleBitrate(options: {
      inputPath: string;
      outputDir: string;
      bitrate: number;
      segmentDuration: number;
      id: string;
      userId?: string;
   }): Promise<{
      bitrate: number;
      playlist: string;
      segments: string[];
   }> {
      const { inputPath, outputDir, bitrate, segmentDuration, id, userId } = options;

      try {
         // Initialize storage provider
         await this.initializeStorageProvider();

         // Ensure input file exists and download to temp location
         await this.ensureInputFileExists(inputPath);
         const tempInputPath = await this.downloadToTemp(inputPath);

         // Create output directory structure
         await this.ensureOutputDirectory(outputDir);

         console.log(`Starting single bitrate transcoding for bitrate ${bitrate}k for chapter ${id}`);

         // Transcode to specific bitrate
         const result = await this.transcodeToBitrate({
            inputPath: tempInputPath,
            outputDir,
            bitrate,
            segmentDuration,
            id,
            ...(userId && { userId })
         });

         console.log(`Successfully completed single bitrate transcoding for bitrate ${bitrate}k`);

         // Clean up temporary input file
         await this.cleanupTempFiles(tempInputPath);

         return result;

      } catch (error: any) {
         console.error(`Single bitrate transcoding failed for bitrate ${bitrate}k:`, error);
         throw new Error(`Single bitrate transcoding failed: ${error.message}`);
      }
   }
   private async transcodeToBitrate(options: {
      inputPath: string;
      outputDir: string;
      bitrate: number;
      segmentDuration: number;
      id: string;
      userId?: string;
   }): Promise<{
      bitrate: number;
      playlist: string;
      segments: string[];
   }> {
      const { inputPath, outputDir, bitrate, segmentDuration, id } = options;

      return new Promise((resolve, reject) => {
         const bitrateDir = path.join(process.cwd(), 'storage', outputDir, `${bitrate}k`);
         const playlistPath = path.join(bitrateDir, 'playlist.m3u8');
         const segmentPattern = path.join(bitrateDir, 'segment_%03d.ts');

         // Ensure bitrate directory exists
         this.ensureOutputDirectory(path.join(outputDir, `${bitrate}k`));

         // Update job status to processing
         this.updateTranscodingJob(id, bitrate, 'processing', 0);

         const command = ffmpeg(inputPath)
            .audioCodec('aac')
            .audioBitrate(bitrate)
            .audioChannels(2)
            .audioFrequency(44100)
            .format('hls')
            .outputOptions([
               `-hls_time ${segmentDuration}`,
               `-hls_list_size 0`,
               `-hls_segment_filename ${segmentPattern}`,
               '-hls_flags independent_segments'
            ])
            .output(playlistPath);

         // const segments: string[] = [];
         let progress = 0;

         command
            .on('start', (commandLine: string) => {
               console.log(`Starting transcoding for bitrate ${bitrate}: ${commandLine}`);
            })
            .on('progress', (progressInfo: any) => {
               if (progressInfo.percent) {
                  progress = Math.round(progressInfo.percent);
                  this.updateTranscodingJob(id, bitrate, 'processing', progress);
               }
            })
            .on('end', async () => {
               try {
                  console.log(`Transcoding completed for bitrate ${bitrate}`);

                  // Read generated playlist
                  const playlistContent = await fs.readFile(playlistPath, 'utf-8');

                  // Upload playlist and segments to storage
                  await this.uploadTranscodedFiles(bitrateDir, bitrate, playlistContent);

                  // Get segment list from playlist
                  const segmentList = this.extractSegmentsFromPlaylist(playlistContent);

                  // Update job status to completed
                  await this.updateTranscodingJob(id, bitrate, 'completed', 100);

                  resolve({
                     bitrate,
                     playlist: playlistContent,
                     segments: segmentList
                  });

               } catch (error: any) {
                  console.error(`Error processing transcoded files for bitrate ${bitrate}:`, error);
                  reject(error);
               }
            })
            .on('error', async (error: Error) => {
               console.error(`Transcoding error for bitrate ${bitrate}:`, error);
               await this.updateTranscodingJob(id, bitrate, 'failed', progress, error.message);
               reject(error);
            });

         command.run();
      });
   }

   /**
    * Upload transcoded files to storage
    */
   private async uploadTranscodedFiles(
      bitrateDir: string,
      _bitrate: number,
      playlistContent: string
   ): Promise<void> {
      try {
         // Ensure storage provider is initialized
         if (!this.storageProvider) {
            await this.initializeStorageProvider();
         }

         // For local storage, files are already in the correct location
         // Just ensure the playlist content is written correctly
         if (config.STORAGE_PROVIDER === 'local') {
            const playlistPath = path.join(bitrateDir, 'playlist.m3u8');
            await fs.writeFile(playlistPath, playlistContent, 'utf-8');
            console.log(`Files stored locally in: ${bitrateDir}`);
            return;
         }

         // For cloud storage (S3), upload files
         const playlistPath = path.join(bitrateDir, 'playlist.m3u8');
         const relativePlaylistPath = path.relative(path.join(process.cwd(), 'storage'), playlistPath);
         await this.storageProvider!.uploadFile(
            relativePlaylistPath,
            Buffer.from(playlistContent),
            'application/vnd.apple.mpegurl'
         );

         // Upload segments
         const segmentFiles = await fs.readdir(bitrateDir);
         const segmentPattern = /segment_\d+\.ts$/;

         for (const file of segmentFiles) {
            if (segmentPattern.test(file)) {
               const segmentPath = path.join(bitrateDir, file);
               const relativeSegmentPath = path.relative(path.join(process.cwd(), 'storage'), segmentPath);
               const segmentContent = await fs.readFile(segmentPath);

               await this.storageProvider!.uploadFile(
                  relativeSegmentPath,
                  segmentContent,
                  'video/mp2t'
               );
            }
         }

         // Clean up local transcoded files after successful upload to cloud storage
         await this.cleanupLocalTranscodedFiles(bitrateDir);

      } catch (error: any) {
         console.error('Error uploading transcoded files:', error);
         throw error;
      }
   }

   /**
    * Generate master playlist (public method for Bull jobs)
    */
   public generateMasterPlaylist(
      variantPlaylists: Array<{ bitrate: number; playlist: string; segments: string[] }>,
      _outputDir: string
   ): string {
      let masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:3\n\n';

      for (const variant of variantPlaylists) {
         const bandwidth = variant.bitrate * 1000; // Convert kbps to bps
         const playlistUrl = `${variant.bitrate}k/playlist.m3u8`;

         masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},CODECS="mp4a.40.2"\n`;
         masterPlaylist += `${playlistUrl}\n\n`;
      }

      return masterPlaylist;
   }

   /**
    * Extract segment list from playlist content
    */
   private extractSegmentsFromPlaylist(playlistContent: string): string[] {
      const segments: string[] = [];
      const lines = playlistContent.split('\n');

      for (const line of lines) {
         if (line.endsWith('.ts')) {
            segments.push(line.trim());
         }
      }

      return segments;
   }

   /**
    * Download file to temporary location
    */
   private async downloadToTemp(filePath: string): Promise<string> {
      try {
         // Ensure storage provider is initialized
         if (!this.storageProvider) {
            await this.initializeStorageProvider();
         }

         const tempDir = path.join(process.cwd(), 'storage', 'temp');
         await fs.mkdir(tempDir, { recursive: true });

         const fileName = path.basename(filePath);
         const tempPath = path.join(tempDir, `temp_${Date.now()}_${fileName}`);

         const fileContent = await this.storageProvider!.downloadFile(filePath);
         await fs.writeFile(tempPath, fileContent);

         return tempPath;
      } catch (error: any) {
         console.error('Error downloading file to temp:', error);
         throw error;
      }
   }

   /**
    * Clean up local transcoded files and directory
    */
   private async cleanupLocalTranscodedFiles(bitrateDir: string): Promise<void> {
      try {
         // Remove all files in the bitrate directory
         const files = await fs.readdir(bitrateDir);

         for (const file of files) {
            const filePath = path.join(bitrateDir, file);
            await fs.unlink(filePath);
         }

         // Remove the empty bitrate directory
         await fs.rmdir(bitrateDir);

         console.log(`Cleaned up local transcoded files from: ${bitrateDir}`);
      } catch (error: any) {
         console.error('Error cleaning up local transcoded files:', error);
         // Don't throw error as this is cleanup - transcoding was successful
      }
   }
   private async cleanupTempFiles(tempPath: string): Promise<void> {
      try {
         // Remove the temp file
         await fs.unlink(tempPath);

         // Get the temp directory path
         const tempDir = path.dirname(tempPath);

         // Check if temp directory is empty and remove it
         try {
            const files = await fs.readdir(tempDir);
            if (files.length === 0) {
               await fs.rmdir(tempDir);
               console.log(`Cleaned up empty temp directory: ${tempDir}`);
            }
         } catch (error: any) {
            console.log(`Could not remove temp directory ${tempDir}:`, error.message);
         }

         console.log(`Cleaned up temp file: ${tempPath}`);
      } catch (error: any) {
         console.error('Error cleaning up temp files:', error);
      }
   }

   /**
    * Ensure output directory exists
    */
   private async ensureOutputDirectory(outputDir: string): Promise<void> {
      try {
         const fullPath = path.join(process.cwd(), 'storage', outputDir);
         await fs.mkdir(fullPath, { recursive: true });
      } catch (error: any) {
         console.error('Error creating output directory:', error);
         throw error;
      }
   }

   /**
    * Update transcoded chapter in database
    */
   private async updateTranscodedChapter(
      id: string,
      bitrate: number,
      _result: { bitrate: number; playlist: string; segments: string[] }
   ): Promise<void> {
      try {
         const playlistUrl = `bit_transcode/${id}/${bitrate}k/playlist.m3u8`;
         const segmentsPath = `bit_transcode/${id}/${bitrate}k/`;

         await this.prisma.transcodedChapter.upsert({
            where: {
               chapterId_bitrate: {
                  chapterId: id,
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
               chapterId: id,
               bitrate,
               playlistUrl,
               segmentsPath,
               storageProvider: config.STORAGE_PROVIDER,
               status: 'completed'
            }
         });
      } catch (error: any) {
         console.error('Error updating transcoded chapter:', error);
         throw error;
      }
   }

   /**
    * Update transcoding job in database
    */
   private async updateTranscodingJob(
      id: string,
      _bitrate: number,
      status: string,
      progress: number,
      errorMessage?: string
   ): Promise<void> {
      try {
         // Find the most recent job for this chapter
         const existingJob = await this.prisma.transcodingJob.findFirst({
            where: { chapterId: id },
            orderBy: { createdAt: 'desc' }
         });

         if (existingJob) {
            // Update existing job
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
                  chapterId: id,
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

   /**
    * Get transcoding status for a chapter
    */
   async getTranscodingStatus(chapterId: string): Promise<{
      chapterId: string;
      transcodedBitrates: number[];
      pendingBitrates: number[];
      failedBitrates: number[];
      overallStatus: 'pending' | 'processing' | 'completed' | 'partial' | 'failed';
   }> {
      try {
         const transcodedChapters = await this.prisma.transcodedChapter.findMany({
            where: { chapterId },
            select: { bitrate: true, status: true }
         });

         const jobs = await this.prisma.transcodingJob.findMany({
            where: { chapterId },
            orderBy: { createdAt: 'desc' },
            select: { status: true, progress: true, errorMessage: true }
         });

         const transcodedBitrates = transcodedChapters
            .filter(tc => tc.status === 'completed')
            .map(tc => tc.bitrate);

         const pendingBitrates = jobs
            .filter(job => job.status === 'pending' || job.status === 'processing')
            .map(() => 0); // We don't track bitrate in jobs table

         const failedBitrates = jobs
            .filter(job => job.status === 'failed')
            .map(() => 0);

         let overallStatus: 'pending' | 'processing' | 'completed' | 'partial' | 'failed' = 'pending';

         if (transcodedBitrates.length > 0) {
            overallStatus = transcodedBitrates.length === config.TRANSCODING_BITRATES.length
               ? 'completed'
               : 'partial';
         } else if (jobs.some(job => job.status === 'processing')) {
            overallStatus = 'processing';
         } else if (jobs.some(job => job.status === 'failed')) {
            overallStatus = 'failed';
         }

         return {
            chapterId,
            transcodedBitrates,
            pendingBitrates,
            failedBitrates,
            overallStatus
         };
      } catch (error: any) {
         console.error('Error getting transcoding status:', error);
         throw error;
      }
   }

   /**
    * Test FFmpeg installation
    */
   async testFFmpegInstallation(): Promise<boolean> {
      return new Promise((resolve) => {
         ffmpeg.getAvailableFormats((err: any, _formats: any) => {
            if (err) {
               console.error('FFmpeg test failed:', err);
               resolve(false);
            } else {
               console.log('FFmpeg is available');
               resolve(true);
            }
         });
      });
   }
}
