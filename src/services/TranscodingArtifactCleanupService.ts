/**
 * Cleans up HLS artifacts for a chapter (local dev or S3 in non-dev)
 */
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/env';
import { resolveBitTranscodeDeletionPrefixes, toStorageKey } from '../utils/storageKeys';
import { logger } from '../config/logger';
import { StorageFactory } from './storage/StorageFactory';

export class TranscodingArtifactCleanupService {
   static scheduleChapterArtifactCleanup(chapterId: string): void {
      void TranscodingArtifactCleanupService.cleanupChapterArtifacts(chapterId).catch(error => {
         logger.warn({ err: error, chapterId }, 'Background HLS artifact cleanup failed');
      });
   }

   static async cleanupChapterArtifacts(chapterId: string): Promise<void> {
      const prefix = toStorageKey(`bit_transcode/${chapterId}`);
      const localDir = path.join(process.cwd(), config.LOCAL_STORAGE_PATH, prefix);

      if (config.NODE_ENV === 'development') {
         try {
            await fs.rm(localDir, { recursive: true, force: true });
            logger.info({ chapterId, localDir }, 'Removed local HLS artifacts for chapter');
         } catch (error: unknown) {
            const code = (error as { code?: string }).code;
            if (code !== 'ENOENT') {
               throw error;
            }
         }
         return;
      }

      if (config.STORAGE_PROVIDER !== 's3') {
         return;
      }

      await StorageFactory.initialize();
      const storageProvider = StorageFactory.getStorageProvider();
      const prefixes = resolveBitTranscodeDeletionPrefixes(chapterId);
      let deletedCount = 0;

      for (const candidatePrefix of prefixes) {
         deletedCount += await storageProvider.deleteFilesByPrefix(candidatePrefix);
      }

      if (deletedCount === 0) {
         logger.warn({ chapterId, prefixes }, 'No S3 HLS artifacts found for chapter during cleanup');
      } else {
         logger.info({ chapterId, prefixes, deletedCount }, 'Removed S3 HLS artifacts for chapter');
      }
   }
}
