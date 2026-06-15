import { config } from '../config/env';
import { StorageProvider } from '../services/storage/StorageProvider';

/**
 * Normalize a relative storage path for the active environment.
 * Non-dev S3 keys live under uploads/; local dev uses ./storage without that prefix.
 */
export function toStorageKey(relativePath: string): string {
   const normalized = relativePath.replace(/^\/+/, '');
   if (config.NODE_ENV === 'development') {
      return normalized.startsWith('uploads/')
         ? normalized.slice('uploads/'.length)
         : normalized;
   }
   return normalized.startsWith('uploads/')
      ? normalized
      : `uploads/${normalized}`;
}

/**
 * Candidate storage keys for chapter source files.
 * DB paths use /uploads/...; legacy app uploads may have stored S3 objects with a leading slash.
 */
export function resolveStorageCandidateKeys(relativePath: string): string[] {
   const trimmed = relativePath.trim();
   const normalized = trimmed.replace(/^\/+/, '');
   const withUploadsPrefix = normalized.startsWith('uploads/')
      ? normalized
      : `uploads/${normalized}`;
   const withoutUploadsPrefix = normalized.startsWith('uploads/')
      ? normalized.slice('uploads/'.length)
      : normalized;
   const legacyLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${withUploadsPrefix}`;
   const primary = toStorageKey(relativePath);

   return [...new Set([
      primary,
      withUploadsPrefix,
      legacyLeadingSlash,
      withoutUploadsPrefix,
   ].filter((key) => key.length > 0))];
}

/**
 * Resolve the first existing storage key for a chapter source file.
 */
export async function resolveExistingStorageKey(
   filePath: string,
   storageProvider: StorageProvider,
): Promise<string | null> {
   for (const key of resolveStorageCandidateKeys(filePath)) {
      if (await storageProvider.fileExists(key)) {
         return key;
      }
   }

   return null;
}
