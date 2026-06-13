/**
 * Cleans up stale HLS artifacts after source audio replacement (non-blocking)
 */
import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/env';
import { toStorageKey } from '../utils/storageKeys';
import { logger } from '../config/logger';

export class TranscodingArtifactCleanupService {
   static scheduleChapterArtifactCleanup(chapterId: string): void {
      void TranscodingArtifactCleanupService.cleanupChapterArtifacts(chapterId).catch(error => {
         logger.warn({ err: error, chapterId }, 'Background HLS artifact cleanup failed');
      });
   }

   private static async cleanupChapterArtifacts(chapterId: string): Promise<void> {
      const prefix = toStorageKey(`bit_transcode/${chapterId}`);
      const localDir = path.join(process.cwd(), config.LOCAL_STORAGE_PATH, prefix);

      try {
         await fs.rm(localDir, { recursive: true, force: true });
         logger.info({ chapterId, localDir }, 'Removed local HLS artifacts for chapter');
      } catch (error: unknown) {
         const code = (error as { code?: string }).code;
         if (code !== 'ENOENT') {
            throw error;
         }
      }

      if (config.NODE_ENV === 'development' || config.STORAGE_PROVIDER === 'local') {
         return;
      }

      logger.info({ chapterId, prefix }, 'Skipped cloud prefix cleanup (no bulk delete API)');
   }
}
