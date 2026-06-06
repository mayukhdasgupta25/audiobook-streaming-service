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
