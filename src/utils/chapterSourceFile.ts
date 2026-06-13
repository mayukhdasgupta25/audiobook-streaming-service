import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/env';
import { resolveStorageCandidateKeys } from './storageKeys';

/**
 * Check whether a chapter source audio file exists in local streaming storage.
 */
export async function chapterSourceFileExists(filePath: string): Promise<boolean> {
   const storageRoot = path.join(process.cwd(), config.LOCAL_STORAGE_PATH);
   const candidateKeys = resolveStorageCandidateKeys(filePath);

   for (const key of candidateKeys) {
      try {
         await fs.access(path.join(storageRoot, key));
         return true;
      } catch {
         // try next candidate
      }
   }

   return false;
}

/**
 * Resolve the first existing local path for a chapter source file.
 */
export async function resolveChapterSourceLocalPath(filePath: string): Promise<string | null> {
   const storageRoot = path.join(process.cwd(), config.LOCAL_STORAGE_PATH);
   const candidateKeys = resolveStorageCandidateKeys(filePath);

   for (const key of candidateKeys) {
      const fullPath = path.join(storageRoot, key);
      try {
         await fs.access(fullPath);
         return fullPath;
      } catch {
         // try next candidate
      }
   }

   return null;
}
