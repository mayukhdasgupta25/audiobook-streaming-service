/**
 * Cleans up HLS artifacts for a chapter (local dev or S3 in non-dev)
 */
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/env';
import { toStorageKey } from '../utils/storageKeys';
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

      try {
         const storageProvider = StorageFactory.getStorageProvider();
         const deletedCount = await storageProvider.deleteFilesByPrefix(prefix);
         logger.info({ chapterId, prefix, deletedCount }, 'Removed S3 HLS artifacts for chapter');
      } catch (error: unknown) {
         logger.error({ err: error, chapterId, prefix }, 'Failed to remove S3 HLS artifacts for chapter');
         throw error;
      }
   }
}
