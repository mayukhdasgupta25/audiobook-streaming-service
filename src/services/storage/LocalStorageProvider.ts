/**
 * Local File System Storage Provider
 * Implements StorageProvider interface for local file system storage
 */
import fs from 'fs/promises';
import path from 'path';
import { StorageProvider, FileMetadata } from './StorageProvider';
import { logger } from '../../config/logger';
import { resolveStorageCandidateKeys } from '../../utils/storageKeys';

export class LocalStorageProvider implements StorageProvider {
   private basePath: string;

   constructor(basePath: string = './storage') {
      this.basePath = path.resolve(basePath);
   }

   /**
    * Upload a file to local storage
    */
   async uploadFile(
      filePath: string,
      fileContent: Buffer,
      contentType?: string,
      metadata?: Record<string, string>
   ): Promise<string> {
      try {
         const fullPath = path.join(this.basePath, filePath);
         const dir = path.dirname(fullPath);

         // Ensure directory exists
         await fs.mkdir(dir, { recursive: true });

         // Write file
         await fs.writeFile(fullPath, fileContent);

         // Store metadata if provided
         if (metadata) {
            const metadataPath = `${fullPath}.metadata.json`;
            await fs.writeFile(metadataPath, JSON.stringify(metadata));
         }

         return filePath;
      } catch (error: any) {
         logger.error({ err: error }, 'Error uploading file to local storage');
         throw new Error(`Failed to upload file: ${error.message}`);
      }
   }

   /**
    * Download a file from local storage
    */
   async downloadFile(filePath: string): Promise<Buffer> {
      try {
         const resolvedPath = await this.resolveExistingPath(filePath);
         return await fs.readFile(resolvedPath);
      } catch (error: any) {
         logger.error({ err: error }, 'Error downloading file from local storage');
         throw new Error(`Failed to download file: ${error.message}`);
      }
   }

   /**
    * Delete a file from local storage
    */
   async deleteFile(filePath: string): Promise<boolean> {
      try {
         const fullPath = path.join(this.basePath, filePath);
         await fs.unlink(fullPath);

         // Also delete metadata file if it exists
         const metadataPath = `${fullPath}.metadata.json`;
         try {
            await fs.unlink(metadataPath);
         } catch {
            // Metadata file doesn't exist, ignore
         }

         return true;
      } catch (error: any) {
         logger.error({ err: error }, 'Error deleting file from local storage');
         return false;
      }
   }

   /**
    * Delete all files under a local storage prefix
    */
   async deleteFilesByPrefix(prefix: string): Promise<number> {
      const localDir = path.join(this.basePath, prefix.replace(/\/+$/, ''));

      try {
         const entries = await fs.readdir(localDir, { withFileTypes: true, recursive: true });
         const fileCount = entries.filter(entry => entry.isFile()).length;
         await fs.rm(localDir, { recursive: true, force: true });
         return fileCount;
      } catch (error: unknown) {
         const code = (error as { code?: string }).code;
         if (code === 'ENOENT') {
            return 0;
         }
         logger.error({ err: error, prefix }, 'Error deleting files by prefix from local storage');
         throw error;
      }
   }

   /**
    * Get a public URL for a file (for local storage, this is just the file path)
    */
   async getFileUrl(filePath: string): Promise<string> {
      // For local storage, we return the file path
      // In a real implementation, you might want to serve files through a web server
      return `/storage/${filePath}`;
   }

   /**
    * Check if a file exists in local storage
    */
   async fileExists(filePath: string): Promise<boolean> {
      try {
         await this.resolveExistingPath(filePath);
         return true;
      } catch {
         return false;
      }
   }

   private async resolveExistingPath(filePath: string): Promise<string> {
      const candidateKeys = resolveStorageCandidateKeys(filePath);
      let lastError: unknown;

      for (const key of candidateKeys) {
         const fullPath = path.join(this.basePath, key);
         try {
            await fs.access(fullPath);
            return fullPath;
         } catch (error) {
            lastError = error;
         }
      }

      throw lastError ?? new Error(`File not found: ${filePath}`);
   }

   /**
    * List files in a directory
    */
   async listFiles(prefix: string): Promise<string[]> {
      try {
         const fullPath = path.join(this.basePath, prefix);
         const files = await fs.readdir(fullPath, { withFileTypes: true });

         const fileList: string[] = [];
         for (const file of files) {
            if (file.isFile()) {
               const relativePath = path.relative(this.basePath, path.join(fullPath, file.name));
               fileList.push(relativePath);
            } else if (file.isDirectory()) {
               // Recursively list files in subdirectories
               const subFiles = await this.listFiles(path.join(prefix, file.name));
               fileList.push(...subFiles);
            }
         }

         return fileList;
      } catch (error: any) {
         logger.error({ err: error }, 'Error listing files in local storage');
         return [];
      }
   }

   /**
    * Get file metadata
    */
   async getFileMetadata(filePath: string): Promise<FileMetadata | null> {
      try {
         const fullPath = path.join(this.basePath, filePath);
         const stats = await fs.stat(fullPath);

         return {
            size: stats.size,
            lastModified: stats.mtime,
            contentType: undefined // We don't store content type in local storage
         };
      } catch (error: any) {
         logger.error({ err: error }, 'Error getting file metadata from local storage');
         return null;
      }
   }

   /**
    * Copy a file within local storage
    */
   async copyFile(sourcePath: string, destinationPath: string): Promise<boolean> {
      try {
         const sourceFullPath = path.join(this.basePath, sourcePath);
         const destFullPath = path.join(this.basePath, destinationPath);
         const destDir = path.dirname(destFullPath);

         // Ensure destination directory exists
         await fs.mkdir(destDir, { recursive: true });

         await fs.copyFile(sourceFullPath, destFullPath);
         return true;
      } catch (error: any) {
         logger.error({ err: error }, 'Error copying file in local storage');
         return false;
      }
   }

   /**
    * Move a file within local storage
    */
   async moveFile(sourcePath: string, destinationPath: string): Promise<boolean> {
      try {
         const sourceFullPath = path.join(this.basePath, sourcePath);
         const destFullPath = path.join(this.basePath, destinationPath);
         const destDir = path.dirname(destFullPath);

         // Ensure destination directory exists
         await fs.mkdir(destDir, { recursive: true });

         await fs.rename(sourceFullPath, destFullPath);
         return true;
      } catch (error: any) {
         logger.error({ err: error }, 'Error moving file in local storage');
         return false;
      }
   }

   /**
    * Test connection to local storage
    */
   async testConnection(): Promise<boolean> {
      try {
         // Ensure base directory exists
         await fs.mkdir(this.basePath, { recursive: true });

         // Test write access
         const testFile = path.join(this.basePath, '.test');
         await fs.writeFile(testFile, 'test');
         await fs.unlink(testFile);

         return true;
      } catch (error: any) {
         logger.error({ err: error }, 'Error testing local storage connection');
         return false;
      }
   }
}
