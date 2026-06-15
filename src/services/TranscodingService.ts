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
import { toStorageKey, resolveStorageCandidateKeys, resolveExistingStorageKey } from '../utils/storageKeys';
import { resolveChapterSourceLocalPath } from '../utils/chapterSourceFile';
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { BitrateTranscodingRepository } from './BitrateTranscodingRepository';
import { TranscodingEventPublisher } from './TranscodingEventPublisher';
import { configureFfmpeg } from '../utils/ffmpegPath';

configureFfmpeg();

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
   private readonly bitrateRepo: BitrateTranscodingRepository;
   private readonly eventPublisher: TranscodingEventPublisher;
   private readonly chapterSourceKeyByPath = new Map<string, string>();

   constructor(prisma: PrismaClient) {
      this.prisma = prisma;
      this.bitrateRepo = new BitrateTranscodingRepository(prisma);
      this.eventPublisher = TranscodingEventPublisher.getInstance();
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

   private async resolveChapterSourceStorageKey(filePath: string): Promise<string> {
      const cached = this.chapterSourceKeyByPath.get(filePath);
      if (cached) {
         return cached;
      }

      await this.initializeStorageProvider();
      const storageKey = await resolveExistingStorageKey(filePath, this.storageProvider!);
      if (!storageKey) {
         throw new Error(`Input file not found in storage at path: ${filePath}`);
      }

      this.chapterSourceKeyByPath.set(filePath, storageKey);
      return storageKey;
   }

   /**
    * Ensure input file exists at specified path
    * In development: store in local directory at filePath
    * In other environments: ensure file exists in S3 at filePath
    */
   private async ensureInputFileExists(filePath: string): Promise<void> {
      await this.initializeStorageProvider();

      if (config.NODE_ENV === 'development') {
         const localPath = await resolveChapterSourceLocalPath(filePath);
         if (localPath) {
            logger.info({ fullPath: localPath }, 'Chapter source audio found for transcoding');
            return;
         }

         logger.info({ filePath }, 'Chapter source not found locally, checking storage provider');
         const providerPaths = resolveStorageCandidateKeys(filePath);
         for (const providerPath of providerPaths) {
            const fileExists = await this.storageProvider!.fileExists(providerPath);
            if (!fileExists) {
               continue;
            }
            const fileContent = await this.storageProvider!.downloadFile(providerPath);
            const targetPath = path.join(
               process.cwd(),
               config.LOCAL_STORAGE_PATH,
               resolveStorageCandidateKeys(filePath)[0]!
            );
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.writeFile(targetPath, fileContent);
            this.chapterSourceKeyByPath.set(filePath, providerPath);
            logger.info({ targetPath, providerPath }, 'Chapter source downloaded into streaming storage');
            return;
         }

         throw new Error(`Input file not found in storage at path: ${filePath}`);
      }

      const storageKey = await this.resolveChapterSourceStorageKey(filePath);
      logger.info({ filePath, storageKey }, 'File verified in storage');
   }

   /**
    * Transcode audio file to multiple bitrates for HLS streaming
    */
   async transcodeChapter(options: TranscodingOptions): Promise<HLSPlaylist> {
      const { inputPath, outputDir, bitrates, segmentDuration, id, userId } = options;

      try {
         this.chapterSourceKeyByPath.delete(inputPath);

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
               logger.info({ bitrate, chapterId: id }, 'Starting transcoding for bitrate for chapter');

               const result = await this.transcodeToBitrate({
                  inputPath: tempInputPath,
                  outputDir,
                  bitrate,
                  segmentDuration,
                  id,
                  ...(userId && { userId })
               });

               variantPlaylists.push(result);
               logger.info({ bitrate }, 'Successfully completed transcoding for bitrate');

               // Update database with transcoded chapter info
               await this.updateTranscodedChapter(id, bitrate, result);

            } catch (error: any) {
               logger.error({
                  err: error,
                  bitrate,
                  chapterId: id
               }, 'Failed to transcode bitrate for chapter');

               // Update database with error
               await this.updateTranscodingJob(id, bitrate, 'failed', 0, error.message);

               // Continue with other bitrates
               continue;
            }
         }

         // Generate master playlist
         const masterPlaylist = this.generateMasterPlaylist(variantPlaylists, id);

         // Upload master playlist to bit_transcode/{chapter_id} directory
         const masterPlaylistPath = toStorageKey(`bit_transcode/${id}/master.m3u8`);
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
         logger.error({ err: error }, 'Transcoding failed');
         throw new Error(`Transcoding failed: ${error.message}`);
      } finally {
         this.chapterSourceKeyByPath.delete(inputPath);
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
         this.chapterSourceKeyByPath.delete(inputPath);

         // Initialize storage provider
         await this.initializeStorageProvider();

         // Ensure input file exists and download to temp location
         await this.ensureInputFileExists(inputPath);
         const tempInputPath = await this.downloadToTemp(inputPath);

         // Create output directory structure
         await this.ensureOutputDirectory(outputDir);

         logger.info({ bitrate, chapterId: id }, 'Starting single bitrate transcoding for chapter');

         // Transcode to specific bitrate
         const result = await this.transcodeToBitrate({
            inputPath: tempInputPath,
            outputDir,
            bitrate,
            segmentDuration,
            id,
            ...(userId && { userId })
         });

         logger.info({ bitrate }, 'Successfully completed single bitrate transcoding for bitrate');

         // Clean up temporary input file
         await this.cleanupTempFiles(tempInputPath);

         return result;

      } catch (error: any) {
         logger.error({ err: error, bitrate }, 'Single bitrate transcoding failed for bitrate');
         throw new Error(`Single bitrate transcoding failed: ${error.message}`);
      } finally {
         this.chapterSourceKeyByPath.delete(inputPath);
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

      await this.bitrateRepo.markProcessing(id, bitrate);
      await this.eventPublisher.publishStatusTransition(id, bitrate, 'processing', 0);

      return new Promise((resolve, reject) => {
         const bitrateDir = path.join(process.cwd(), config.LOCAL_STORAGE_PATH, outputDir, `${bitrate}k`);
         const playlistPath = path.join(bitrateDir, 'playlist.m3u8');
         const segmentPattern = path.join(bitrateDir, 'segment_%03d.m4s');

         // Ensure bitrate directory exists
         this.ensureOutputDirectory(path.join(outputDir, `${bitrate}k`));

         // Determine audio channels: mono (1) for 64k, stereo (2) for others
         const audioChannels = bitrate === 64 ? 1 : 2;

         // Use unique temporary filename for init file to prevent overwrites when multiple bitrates run in parallel
         const tempInitFilename = `init_${bitrate}k_temp.mp4`;
         const rootTempInitPath = path.join(process.cwd(), tempInitFilename);
         const bitrateTempInitPath = path.join(bitrateDir, tempInitFilename);
         const targetInitPath = path.join(bitrateDir, 'init.mp4');

         const command = ffmpeg(inputPath)
            .audioCodec('aac')
            .audioBitrate(bitrate)
            .audioChannels(audioChannels)
            .audioFrequency(48000)
            .audioFilters('lowpass=f=20000')
            .format('hls')
            .outputOptions([
               `-profile:a aac_low`,
               `-hls_time ${segmentDuration}`,
               `-hls_list_size 0`,
               `-hls_segment_type fmp4`,
               `-hls_segment_filename ${segmentPattern}`,
               `-hls_fmp4_init_filename ${tempInitFilename}`,
               '-hls_flags independent_segments',
               '-avoid_negative_ts make_zero'
            ])
            .output(playlistPath);

         // const segments: string[] = [];
         let progress = 0;

         command
            .on('start', (commandLine: string) => {
               logger.info({ bitrate, commandLine }, 'Starting transcoding for bitrate');
            })
            .on('progress', (progressInfo: { percent?: number }) => {
               if (progressInfo.percent) {
                  progress = Math.round(Math.min(85, progressInfo.percent));
                  void this.bitrateRepo.updateProgress(id, bitrate, progress);
                  void this.eventPublisher.publishProgress(id, bitrate, progress);
                  void this.updateTranscodingJob(id, bitrate, 'processing', progress);
               }
            })
            .on('end', async () => {
               try {
                  logger.info({ bitrate }, 'Transcoding completed for bitrate');

                  // Move unique temporary init file from bitrate directory or root to final location
                  await this.moveTempInitFileToBitrateDir(bitrateTempInitPath, rootTempInitPath, targetInitPath, bitrate);

                  // Also check for generic init.mp4 (backward compatibility)
                  await this.moveInitFileToBitrateDir(bitrateDir);

                  // Read generated playlist
                  let playlistContent = await fs.readFile(playlistPath, 'utf-8');

                  // Replace temporary init filename with init.mp4 in playlist content
                  playlistContent = playlistContent.replace(
                     new RegExp(tempInitFilename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                     'init.mp4'
                  );

                  // Convert relative paths to absolute URLs
                  const baseUrl = config.STREAMING_BASE_URL;
                  const segmentsBasePath = `bit_transcode/${id}/${bitrate}k`;

                  // Replace init.mp4 in #EXT-X-MAP:URI with absolute URL
                  playlistContent = playlistContent.replace(
                     /#EXT-X-MAP:URI="([^"]+)"/g,
                     (match, uri) => {
                        // If URI is already absolute, keep it; otherwise make it absolute
                        if (uri.startsWith('http://') || uri.startsWith('https://')) {
                           return match;
                        }
                        const absoluteUri = uri === 'init.mp4'
                           ? `${baseUrl}/${segmentsBasePath}/init.mp4`
                           : `${baseUrl}/${segmentsBasePath}/${uri}`;
                        return `#EXT-X-MAP:URI="${absoluteUri}"`;
                     }
                  );

                  // Replace relative segment paths with absolute URLs
                  // Match lines that are segment filenames (not starting with #)
                  playlistContent = playlistContent.split('\n').map(line => {
                     const trimmedLine = line.trim();
                     // Skip if line is empty, starts with #, or is already an absolute URL
                     if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('http://') || trimmedLine.startsWith('https://')) {
                        return line;
                     }
                     // This is a segment filename, convert to absolute URL
                     return `${baseUrl}/${segmentsBasePath}/${trimmedLine}`;
                  }).join('\n');

                  // Write updated playlist content back to file
                  await fs.writeFile(playlistPath, playlistContent, 'utf-8');

                  // DB commit before S3 upload (prod)
                  await this.bitrateRepo.updateProgress(id, bitrate, 88);
                  await this.eventPublisher.publishProgress(id, bitrate, 88, { force: true });
                  await this.bitrateRepo.commitCompletedLocal(id, bitrate);

                  if (config.NODE_ENV !== 'development' && config.STORAGE_PROVIDER !== 'local') {
                     await this.uploadTranscodedFilesWithProgress(bitrateDir, id, bitrate);
                     await this.bitrateRepo.markStoredOnS3(id, bitrate);
                  }

                  await this.eventPublisher.publishStatusTransition(id, bitrate, 'completed', 100);
                  await this.updateTranscodingJob(id, bitrate, 'completed', 100);

                  // Get segment list from playlist
                  const segmentList = this.extractSegmentsFromPlaylist(playlistContent);

                  resolve({
                     bitrate,
                     playlist: playlistContent,
                     segments: segmentList
                  });

               } catch (error: unknown) {
                  const message = error instanceof Error ? error.message : 'Unknown error';
                  logger.error({ err: error, bitrate }, 'Error processing transcoded files for bitrate');
                  reject(new Error(message));
               }
            })
            .on('error', async (error: Error) => {
               logger.error({ err: error, bitrate }, 'Transcoding error for bitrate');
               await this.bitrateRepo.markFailed(id, bitrate, progress, error.message);
               await this.eventPublisher.publishStatusTransition(
                  id,
                  bitrate,
                  'failed',
                  progress,
                  error.message
               );
               await this.updateTranscodingJob(id, bitrate, 'failed', progress, error.message);
               reject(error);
            });

         command.run();
      });
   }

   /**
    * Upload transcoded files to cloud storage with progress events (91-99%)
    */
   private async uploadTranscodedFilesWithProgress(
      bitrateDir: string,
      chapterId: string,
      bitrate: number
   ): Promise<void> {
      if (!this.storageProvider) {
         await this.initializeStorageProvider();
      }

      const segmentFiles = await fs.readdir(bitrateDir);
      const uploadable = segmentFiles.filter(
         f => /segment_\d+\.m4s$/.test(f) || f === 'init.mp4' || f === 'playlist.m3u8'
      );
      let uploaded = 0;

      for (const file of uploadable) {
         const filePath = path.join(bitrateDir, file);
         const relativePath = toStorageKey(
            path.relative(path.join(process.cwd(), config.LOCAL_STORAGE_PATH), filePath).replace(/\\/g, '/')
         );
         const content = await fs.readFile(filePath);
         const contentType = file.endsWith('.m3u8')
            ? 'application/vnd.apple.mpegurl'
            : 'video/mp4';
         await this.storageProvider!.uploadFile(relativePath, content, contentType);
         uploaded += 1;
         const uploadProgress = 91 + Math.round((uploaded / uploadable.length) * 8);
         await this.bitrateRepo.updateProgress(chapterId, bitrate, uploadProgress);
         await this.eventPublisher.publishProgress(chapterId, bitrate, uploadProgress, { force: true });
      }

      await this.cleanupLocalTranscodedFiles(bitrateDir);
   }

   /**
    * Upload transcoded files to storage (legacy batch path)
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
         // Note: init.mp4 is already moved to bitrate directory in the on('end') handler
         if (config.STORAGE_PROVIDER === 'local') {
            const playlistPath = path.join(bitrateDir, 'playlist.m3u8');
            await fs.writeFile(playlistPath, playlistContent, 'utf-8');
            logger.info({ bitrateDir }, 'Files stored locally in directory');
            return;
         }

         // For cloud storage (S3), upload files
         const playlistPath = path.join(bitrateDir, 'playlist.m3u8');
         const relativePlaylistPath = toStorageKey(
            path.relative(path.join(process.cwd(), config.LOCAL_STORAGE_PATH), playlistPath).replace(/\\/g, '/')
         );
         await this.storageProvider!.uploadFile(
            relativePlaylistPath,
            Buffer.from(playlistContent),
            'application/vnd.apple.mpegurl'
         );

         // Upload segments and init file
         const segmentFiles = await fs.readdir(bitrateDir);
         const segmentPattern = /segment_\d+\.m4s$/;
         const initPattern = /init\.mp4$/;

         for (const file of segmentFiles) {
            // Upload init segment
            if (initPattern.test(file)) {
               const initPath = path.join(bitrateDir, file);
               const relativeInitPath = toStorageKey(
                  path.relative(path.join(process.cwd(), config.LOCAL_STORAGE_PATH), initPath).replace(/\\/g, '/')
               );
               const initContent = await fs.readFile(initPath);

               await this.storageProvider!.uploadFile(
                  relativeInitPath,
                  initContent,
                  'video/mp4'
               );
            }
            // Upload media segments
            else if (segmentPattern.test(file)) {
               const segmentPath = path.join(bitrateDir, file);
               const relativeSegmentPath = toStorageKey(
                  path.relative(path.join(process.cwd(), config.LOCAL_STORAGE_PATH), segmentPath).replace(/\\/g, '/')
               );
               const segmentContent = await fs.readFile(segmentPath);

               await this.storageProvider!.uploadFile(
                  relativeSegmentPath,
                  segmentContent,
                  'video/mp4'
               );
            }
         }

         // Clean up local transcoded files after successful upload to cloud storage
         await this.cleanupLocalTranscodedFiles(bitrateDir);

      } catch (error: any) {
         logger.error({ err: error }, 'Error uploading transcoded files');
         throw error;
      }
   }

   /**
    * Generate master playlist (public method for Bull jobs)
    */
   public generateMasterPlaylist(
      variantPlaylists: Array<{ bitrate: number; playlist: string; segments: string[] }>,
      chapterId: string
   ): string {
      const baseUrl = config.STREAMING_BASE_URL;
      let masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:7\n\n';

      for (const variant of variantPlaylists) {
         const bandwidth = variant.bitrate * 1000; // Convert kbps to bps
         // Use complete absolute URL for playlist
         const playlistUrl = `${baseUrl}/bit_transcode/${chapterId}/${variant.bitrate}k/playlist.m3u8`;

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
         if (line.endsWith('.m4s') || line.endsWith('.ts')) {
            segments.push(line.trim());
         }
      }

      return segments;
   }

   /**
    * Move unique temporary init file from bitrate directory or root to final location
    * This prevents overwrites when multiple bitrates are transcoded in parallel
    * FFmpeg creates the init file in the same directory as the playlist (bitrate directory)
    */
   private async moveTempInitFileToBitrateDir(
      bitrateTempInitPath: string,
      rootTempInitPath: string,
      targetInitPath: string,
      bitrate: number
   ): Promise<void> {
      try {
         // Ensure target directory exists
         const bitrateDir = path.dirname(targetInitPath);
         await fs.mkdir(bitrateDir, { recursive: true });

         // First, check if temp init file exists in bitrate directory (where FFmpeg actually creates it)
         try {
            await fs.access(bitrateTempInitPath);
            // Rename temp file to init.mp4 in the bitrate directory
            await fs.rename(bitrateTempInitPath, targetInitPath);
            logger.info({ bitrateDir, bitrate }, 'Renamed temp init file to init.mp4 in bitrate directory');
            return;
         } catch (error: any) {
            // Temp init file doesn't exist in bitrate directory
            if (error.code !== 'ENOENT') {
               throw error;
            }
         }

         // Fallback: Check if temp init file exists in root directory (for backward compatibility)
         try {
            await fs.access(rootTempInitPath);
            // Move temp init file from root to bitrate directory and rename to init.mp4
            await fs.rename(rootTempInitPath, targetInitPath);
            logger.info({ bitrateDir, bitrate }, 'Moved temp init file from root to bitrate directory');
            return;
         } catch (error: any) {
            // Temp init file doesn't exist in root either
            if (error.code !== 'ENOENT') {
               throw error;
            }
         }

         // Check if init.mp4 already exists in the correct location
         try {
            await fs.access(targetInitPath);
            logger.info({ bitrateDir }, 'init.mp4 already exists in bitrate directory');
         } catch {
            // init.mp4 doesn't exist, which might be an issue
            logger.warn({ bitrate, bitrateDir }, 'init.mp4 not found for bitrate in directory');
         }
      } catch (error: any) {
         logger.error({ err: error, bitrate }, 'Error moving temp init file for bitrate');
         // Don't throw error, as this is a cleanup operation
      }
   }

   /**
    * Move init.mp4 from project root to bitrate directory if it exists in root
    * FFmpeg sometimes creates init.mp4 in the current working directory instead of the bitrate directory
    * This is a fallback for backward compatibility
    */
   private async moveInitFileToBitrateDir(bitrateDir: string): Promise<void> {
      try {
         const rootInitPath = path.join(process.cwd(), 'init.mp4');
         const targetInitPath = path.join(bitrateDir, 'init.mp4');

         // Check if init.mp4 exists in root directory
         try {
            await fs.access(rootInitPath);

            // Check if target directory exists, create if not
            await fs.mkdir(bitrateDir, { recursive: true });

            // Move init.mp4 from root to bitrate directory
            await fs.rename(rootInitPath, targetInitPath);
            logger.info({ bitrateDir }, 'Moved init.mp4 from root to bitrate directory');
         } catch (error: any) {
            // init.mp4 doesn't exist in root, check if it already exists in bitrate directory
            if (error.code !== 'ENOENT') {
               throw error;
            }

            // Check if init.mp4 already exists in the correct location
            try {
               await fs.access(targetInitPath);
               logger.info({ bitrateDir }, 'init.mp4 already exists in bitrate directory');
            } catch {
               // init.mp4 doesn't exist in either location, which is fine
               logger.info({ bitrateDir }, 'init.mp4 not found in root or bitrate directory');
            }
         }
      } catch (error: any) {
         logger.error({ err: error }, 'Error moving init.mp4 to bitrate directory');
         // Don't throw error, as this is a cleanup operation
      }
   }

   /**
    * Download file to temporary location
    */
   private async downloadToTemp(filePath: string): Promise<string> {
      try {
         if (!this.storageProvider) {
            await this.initializeStorageProvider();
         }

         const tempDir = path.join(process.cwd(), config.LOCAL_STORAGE_PATH, 'temp');
         await fs.mkdir(tempDir, { recursive: true });

         const fileName = path.basename(filePath);
         const tempPath = path.join(tempDir, `temp_${Date.now()}_${fileName}`);

         if (config.NODE_ENV === 'development') {
            const localPath = await resolveChapterSourceLocalPath(filePath);
            if (localPath) {
               await fs.copyFile(localPath, tempPath);
               return tempPath;
            }
         }

         const storageKey = config.NODE_ENV === 'development'
            ? toStorageKey(filePath)
            : await this.resolveChapterSourceStorageKey(filePath);
         const fileContent = await this.storageProvider!.downloadFile(storageKey);
         await fs.writeFile(tempPath, fileContent);

         return tempPath;
      } catch (error: any) {
         logger.error({ err: error }, 'Error downloading file to temp');
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

         logger.info({ bitrateDir }, 'Cleaned up local transcoded files from directory');
      } catch (error: any) {
         logger.error({ err: error }, 'Error cleaning up local transcoded files');
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
               logger.info({ tempDir }, 'Cleaned up empty temp directory');
            }
         } catch (error: any) {
            logger.info({ tempDir, err: error, message: error.message }, 'Could not remove temp directory');
         }

         logger.info({ tempPath }, 'Cleaned up temp file');
      } catch (error: any) {
         logger.error({ err: error }, 'Error cleaning up temp files');
      }
   }

   /**
    * Ensure output directory exists
    */
   private async ensureOutputDirectory(outputDir: string): Promise<void> {
      try {
         const fullPath = path.join(process.cwd(), config.LOCAL_STORAGE_PATH, outputDir);
         await fs.mkdir(fullPath, { recursive: true });
      } catch (error: any) {
         logger.error({ err: error }, 'Error creating output directory');
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
         const playlistUrl = toStorageKey(`bit_transcode/${id}/${bitrate}k/playlist.m3u8`);
         const segmentsPath = toStorageKey(`bit_transcode/${id}/${bitrate}k/`);

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
         logger.error({ err: error }, 'Error updating transcoded chapter');
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
         logger.error({ err: error }, 'Error updating transcoding job');
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
         logger.error({ err: error }, 'Error getting transcoding status');
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
               logger.error({ err }, 'FFmpeg test failed');
               resolve(false);
            } else {
               logger.info('FFmpeg is available');
               resolve(true);
            }
         });
      });
   }
}
