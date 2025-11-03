/**
 * AWS S3 Storage Provider
 * Implements StorageProvider interface for AWS S3 storage
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageProvider, FileMetadata } from './StorageProvider';

export class S3StorageProvider implements StorageProvider {
   private s3Client: S3Client;
   private bucket: string;
   private region: string;

   constructor(
      bucket: string,
      region: string,
      accessKeyId?: string,
      secretAccessKey?: string,
      endpoint?: string
   ) {
      this.bucket = bucket;
      this.region = region;

      const s3Config: any = {
         region: this.region,
      };

      if (accessKeyId && secretAccessKey) {
         s3Config.credentials = {
            accessKeyId,
            secretAccessKey,
         };
      }

      if (endpoint) {
         s3Config.endpoint = endpoint;
      }

      this.s3Client = new S3Client(s3Config);
   }

   /**
    * Upload a file to S3 storage
    */
   async uploadFile(
      filePath: string,
      fileContent: Buffer,
      contentType?: string,
      metadata?: Record<string, string>
   ): Promise<string> {
      try {
         const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: filePath,
            Body: fileContent,
            ContentType: contentType,
            Metadata: metadata,
         });

         await this.s3Client.send(command);
         return filePath;
      } catch (error: any) {
         console.error('Error uploading file to S3:', error);
         throw new Error(`Failed to upload file to S3: ${error.message}`);
      }
   }

   /**
    * Download a file from S3 storage
    */
   async downloadFile(filePath: string): Promise<Buffer> {
      try {
         const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: filePath,
         });

         const response = await this.s3Client.send(command);

         if (!response.Body) {
            throw new Error('No file content received from S3');
         }

         // Convert stream to buffer
         const chunks: Uint8Array[] = [];
         const reader = response.Body.transformToWebStream().getReader();

         // eslint-disable-next-line no-constant-condition
         while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
         }

         return Buffer.concat(chunks);
      } catch (error: any) {
         console.error('Error downloading file from S3:', error);
         throw new Error(`Failed to download file from S3: ${error.message}`);
      }
   }

   /**
    * Delete a file from S3 storage
    */
   async deleteFile(filePath: string): Promise<boolean> {
      try {
         const command = new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: filePath,
         });

         await this.s3Client.send(command);
         return true;
      } catch (error: any) {
         console.error('Error deleting file from S3:', error);
         return false;
      }
   }

   /**
    * Get a public URL for a file
    */
   async getFileUrl(filePath: string, expiresIn: number = 3600): Promise<string> {
      try {
         const command = new GetObjectCommand({
            Bucket: this.bucket,
            Key: filePath,
         });

         return await getSignedUrl(this.s3Client, command, { expiresIn });
      } catch (error: any) {
         console.error('Error generating file URL from S3:', error);
         throw new Error(`Failed to generate file URL: ${error.message}`);
      }
   }

   /**
    * Check if a file exists in S3 storage
    */
   async fileExists(filePath: string): Promise<boolean> {
      try {
         const command = new HeadObjectCommand({
            Bucket: this.bucket,
            Key: filePath,
         });

         await this.s3Client.send(command);
         return true;
      } catch (error: any) {
         // If the error is 404 (Not Found), the file doesn't exist
         if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
            return false;
         }

         console.error('Error checking file existence in S3:', error);
         throw new Error(`Failed to check file existence: ${error.message}`);
      }
   }

   /**
    * List files in a directory
    */
   async listFiles(prefix: string): Promise<string[]> {
      try {
         const command = new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
         });

         const response = await this.s3Client.send(command);
         return response.Contents?.map((obj: any) => obj.Key || '') || [];
      } catch (error: any) {
         console.error('Error listing files in S3:', error);
         return [];
      }
   }

   /**
    * Get file metadata
    */
   async getFileMetadata(filePath: string): Promise<FileMetadata | null> {
      try {
         const command = new HeadObjectCommand({
            Bucket: this.bucket,
            Key: filePath,
         });

         const response = await this.s3Client.send(command);

         return {
            size: response.ContentLength || 0,
            lastModified: response.LastModified || new Date(),
            contentType: response.ContentType,
            etag: response.ETag,
         };
      } catch (error: any) {
         console.error('Error getting file metadata from S3:', error);
         return null;
      }
   }

   /**
    * Copy a file within S3 storage
    */
   async copyFile(sourcePath: string, destinationPath: string): Promise<boolean> {
      try {
         const command = new CopyObjectCommand({
            Bucket: this.bucket,
            CopySource: `${this.bucket}/${sourcePath}`,
            Key: destinationPath,
         });

         await this.s3Client.send(command);
         return true;
      } catch (error: any) {
         console.error('Error copying file in S3:', error);
         return false;
      }
   }

   /**
    * Move a file within S3 storage
    */
   async moveFile(sourcePath: string, destinationPath: string): Promise<boolean> {
      try {
         // Copy the file
         const copySuccess = await this.copyFile(sourcePath, destinationPath);
         if (!copySuccess) {
            return false;
         }

         // Delete the original file
         return await this.deleteFile(sourcePath);
      } catch (error: any) {
         console.error('Error moving file in S3:', error);
         return false;
      }
   }

   /**
    * Test connection to S3 storage
    */
   async testConnection(): Promise<boolean> {
      try {
         // Try to list objects in the bucket to test connection
         const command = new ListObjectsV2Command({
            Bucket: this.bucket,
            MaxKeys: 1,
         });

         await this.s3Client.send(command);
         return true;
      } catch (error: any) {
         console.error('Error testing S3 connection:', error);
         return false;
      }
   }
}
