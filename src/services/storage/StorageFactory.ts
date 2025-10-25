/**
 * Storage factory for different storage providers
 */
import { StorageProvider, StorageConfig } from './StorageProvider';
import { LocalStorageProvider } from './LocalStorageProvider';
import { S3StorageProvider } from './S3StorageProvider';
import { config } from '../../config/env';

export class StorageFactory {
   private static storageProvider: StorageProvider | null = null;

   /**
    * Get storage provider
    */
   static getStorageProvider(): StorageProvider {
      if (!this.storageProvider) {
         throw new Error('Storage provider not initialized. Call initialize() first.');
      }
      return this.storageProvider;
   }

   /**
    * Initialize storage provider
    */
   static async initialize(): Promise<void> {
      try {
         const storageConfig: StorageConfig = {
            provider: config.STORAGE_PROVIDER as 'local' | 's3',
            bucket: config.AWS_S3_BUCKET,
            region: config.AWS_REGION,
            accessKeyId: config.AWS_ACCESS_KEY_ID,
            secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
            basePath: './storage'
         };

         switch (storageConfig.provider) {
            case 'local':
               this.storageProvider = new LocalStorageProvider(storageConfig.basePath);
               break;
            case 's3':
               if (!storageConfig.bucket) {
                  throw new Error('S3 bucket name is required');
               }
               this.storageProvider = new S3StorageProvider(
                  storageConfig.bucket,
                  storageConfig.region || 'us-east-1',
                  storageConfig.accessKeyId,
                  storageConfig.secretAccessKey
               );
               break;
            default:
               throw new Error(`Unsupported storage provider: ${storageConfig.provider}`);
         }

         // Test the connection
         const isConnected = await this.storageProvider.testConnection();
         if (!isConnected) {
            throw new Error(`Failed to connect to ${storageConfig.provider} storage`);
         }

         console.log(`Storage provider (${storageConfig.provider}) initialized successfully`);
      } catch (error) {
         console.error('Storage initialization failed:', error);
         throw error;
      }
   }

   /**
    * Reset storage provider (useful for testing)
    */
   static reset(): void {
      this.storageProvider = null;
   }
}
