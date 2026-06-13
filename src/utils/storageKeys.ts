import { config } from '../config/env';

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
 * DB paths use /uploads/... while on-disk dev storage may omit or retain that prefix.
 */
export function resolveStorageCandidateKeys(relativePath: string): string[] {
   const normalized = relativePath.replace(/^\/+/, '');
   const primary = toStorageKey(relativePath);
   const withUploadsPrefix = normalized.startsWith('uploads/')
      ? normalized
      : `uploads/${normalized}`;

   return [...new Set([primary, withUploadsPrefix])];
}
