/**
 * Storage Provider Interface
 * Abstract interface for different storage providers (S3, Local)
 */
export interface StorageProvider {
   /**
    * Upload a file to storage
    */
   uploadFile(
      filePath: string,
      fileContent: Buffer,
      contentType?: string,
      metadata?: Record<string, string>
   ): Promise<string>;

   /**
    * Download a file from storage
    */
   downloadFile(filePath: string): Promise<Buffer>;

   /**
    * Delete a file from storage
    */
   deleteFile(filePath: string): Promise<boolean>;

   /**
    * Get a public URL for a file
    */
   getFileUrl(filePath: string, expiresIn?: number): Promise<string>;

   /**
    * Check if a file exists in storage
    */
   fileExists(filePath: string): Promise<boolean>;

   /**
    * List files in a directory
    */
   listFiles(prefix: string): Promise<string[]>;

   /**
    * Get file metadata
    */
   getFileMetadata(filePath: string): Promise<{
      size: number;
      lastModified: Date;
      contentType?: string;
   } | null>;

   /**
    * Copy a file within storage
    */
   copyFile(sourcePath: string, destinationPath: string): Promise<boolean>;

   /**
    * Move a file within storage
    */
   moveFile(sourcePath: string, destinationPath: string): Promise<boolean>;

   /**
    * Test connection to storage
    */
   testConnection(): Promise<boolean>;
}

export interface StorageConfig {
   provider: 'local' | 's3';
   bucket?: string;
   region?: string;
   accessKeyId?: string;
   secretAccessKey?: string;
   endpoint?: string;
   basePath?: string;
}

export interface UploadResult {
   success: boolean;
   filePath?: string;
   url?: string;
   error?: string;
}

export interface FileMetadata {
   size: number;
   lastModified: Date;
   contentType?: string;
   etag?: string;
}
