/**
 * Streaming Cache Service
 * Redis-based caching for HLS playlists and segments
 */
import { RedisConnection } from '../config/redis';
import { StorageProvider } from './storage/StorageProvider';
import { StorageFactory } from './storage/StorageFactory';
import { config } from '../config/env';

export interface CacheStats {
   hits: number;
   misses: number;
   hitRate: number;
   totalRequests: number;
   cacheSize: number;
}

export interface CacheEntry {
   key: string;
   value: Buffer;
   contentType: string;
   size: number;
   createdAt: Date;
   expiresAt: Date;
}

export class StreamingCacheService {
   private redis: RedisConnection;
   private storageProvider: StorageProvider;
   private stats: CacheStats;

   constructor() {
      this.redis = RedisConnection.getInstance();
      this.storageProvider = StorageFactory.getStorageProvider();
      this.stats = {
         hits: 0,
         misses: 0,
         hitRate: 0,
         totalRequests: 0,
         cacheSize: 0
      };
   }

   /**
    * Get cached content by key
    */
   async get(key: string): Promise<Buffer | null> {
      try {
         this.stats.totalRequests++;

         const cached = await this.redis.getClient().get(key);
         if (cached) {
            this.stats.hits++;
            this.updateHitRate();
            return Buffer.from(cached, 'base64');
         }

         this.stats.misses++;
         this.updateHitRate();
         return null;
      } catch (error: any) {
         console.error('Cache get error:', error);
         this.stats.misses++;
         this.updateHitRate();
         return null;
      }
   }

   /**
    * Set cached content
    */
   async set(
      key: string,
      value: Buffer,
      ttlSeconds: number = config.STREAMING_CACHE_TTL,
      contentType?: string
   ): Promise<boolean> {
      try {
         const serializedValue = value.toString('base64');

         // Store with TTL
         await this.redis.getClient().setex(key, ttlSeconds, serializedValue);

         // Store metadata
         const metadataKey = `${key}:meta`;
         const metadata = {
            contentType: contentType || 'application/octet-stream',
            size: value.length,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString()
         };

         await this.redis.getClient().setex(metadataKey, ttlSeconds, JSON.stringify(metadata));

         // Update cache size
         this.stats.cacheSize += value.length;

         return true;
      } catch (error: any) {
         console.error('Cache set error:', error);
         return false;
      }
   }

   /**
    * Delete cached content
    */
   async delete(key: string): Promise<boolean> {
      try {
         const deleted = await this.redis.getClient().del(key);
         await this.redis.getClient().del(`${key}:meta`);
         return deleted > 0;
      } catch (error: any) {
         console.error('Cache delete error:', error);
         return false;
      }
   }

   /**
    * Check if key exists in cache
    */
   async exists(key: string): Promise<boolean> {
      try {
         const exists = await this.redis.getClient().exists(key);
         return exists === 1;
      } catch (error: any) {
         console.error('Cache exists error:', error);
         return false;
      }
   }

   /**
    * Get cached content with fallback to storage
    */
   async getWithFallback(
      key: string,
      storagePath: string,
      contentType?: string
   ): Promise<Buffer | null> {
      try {
         // Try cache first
         let content = await this.get(key);

         if (content) {
            return content;
         }

         // Fallback to storage
         try {
            content = await this.storageProvider.downloadFile(storagePath);

            // Cache the content for future requests
            await this.set(key, content, config.STREAMING_CACHE_TTL, contentType);

            return content;
         } catch (storageError: any) {
            console.error('Storage fallback error:', storageError);
            return null;
         }
      } catch (error: any) {
         console.error('Get with fallback error:', error);
         return null;
      }
   }

   /**
    * Cache HLS playlist
    */
   async cachePlaylist(
      chapterId: string,
      bitrate: number,
      playlistContent: string,
      isMaster: boolean = false
   ): Promise<boolean> {
      try {
         const key = isMaster
            ? `stream:playlist:${chapterId}:master`
            : `stream:playlist:${chapterId}:${bitrate}`;

         const content = Buffer.from(playlistContent, 'utf-8');
         const contentType = 'application/vnd.apple.mpegurl';

         return await this.set(key, content, config.STREAMING_CACHE_TTL, contentType);
      } catch (error: any) {
         console.error('Cache playlist error:', error);
         return false;
      }
   }

   /**
    * Get cached HLS playlist
    */
   async getCachedPlaylist(
      chapterId: string,
      bitrate: number,
      isMaster: boolean = false
   ): Promise<string | null> {
      try {
         const key = isMaster
            ? `stream:playlist:${chapterId}:master`
            : `stream:playlist:${chapterId}:${bitrate}`;

         const content = await this.get(key);
         return content ? content.toString('utf-8') : null;
      } catch (error: any) {
         console.error('Get cached playlist error:', error);
         return null;
      }
   }

   /**
    * Cache HLS segment
    */
   async cacheSegment(
      segmentId: string,
      segmentContent: Buffer
   ): Promise<boolean> {
      try {
         const key = `stream:segment:${segmentId}`;
         const contentType = 'video/mp2t';

         return await this.set(key, segmentContent, config.STREAMING_CACHE_TTL, contentType);
      } catch (error: any) {
         console.error('Cache segment error:', error);
         return false;
      }
   }

   /**
    * Get cached HLS segment
    */
   async getCachedSegment(segmentId: string): Promise<Buffer | null> {
      try {
         const key = `stream:segment:${segmentId}`;
         return await this.get(key);
      } catch (error: any) {
         console.error('Get cached segment error:', error);
         return null;
      }
   }

   /**
    * Get segment with fallback to storage
    */
   async getSegmentWithFallback(
      segmentId: string,
      storagePath: string
   ): Promise<Buffer | null> {
      try {
         const key = `stream:segment:${segmentId}`;
         const contentType = 'video/mp2t';

         return await this.getWithFallback(key, storagePath, contentType);
      } catch (error: any) {
         console.error('Get segment with fallback error:', error);
         return null;
      }
   }

   /**
    * Preload chapter segments into cache
    */
   async preloadChapterSegments(
      chapterId: string,
      bitrate: number,
      segmentCount: number
   ): Promise<number> {
      let loadedCount = 0;

      try {
         for (let i = 0; i < segmentCount; i++) {
            const segmentId = `${chapterId}_${bitrate}_${i.toString().padStart(3, '0')}`;
            const storagePath = `bit_transcode/${chapterId}/${bitrate}k/segment_${i.toString().padStart(3, '0')}.ts`;

            try {
               const segmentContent = await this.storageProvider.downloadFile(storagePath);
               await this.cacheSegment(segmentId, segmentContent);
               loadedCount++;
            } catch (error: any) {
               console.error(`Failed to preload segment ${segmentId}:`, error);
            }
         }
      } catch (error: any) {
         console.error('Preload chapter segments error:', error);
      }

      console.log(`Preloaded ${loadedCount}/${segmentCount} segments for chapter ${chapterId}, bitrate ${bitrate}`);
      return loadedCount;
   }

   /**
    * Clear cache for specific chapter
    */
   async clearChapterCache(chapterId: string): Promise<number> {
      try {
         const pattern = `stream:*:${chapterId}:*`;
         const keys = await this.redis.getClient().keys(pattern);

         if (keys.length > 0) {
            await this.redis.getClient().del(...keys);
         }

         console.log(`Cleared ${keys.length} cache entries for chapter ${chapterId}`);
         return keys.length;
      } catch (error: any) {
         console.error('Clear chapter cache error:', error);
         return 0;
      }
   }

   /**
    * Clear all streaming cache
    */
   async clearAllCache(): Promise<number> {
      try {
         const pattern = 'stream:*';
         const keys = await this.redis.getClient().keys(pattern);

         if (keys.length > 0) {
            await this.redis.getClient().del(...keys);
         }

         console.log(`Cleared ${keys.length} cache entries`);
         return keys.length;
      } catch (error: any) {
         console.error('Clear all cache error:', error);
         return 0;
      }
   }

   /**
    * Get cache statistics
    */
   async getCacheStats(): Promise<CacheStats & {
      redisInfo: any;
      cacheKeys: number;
   }> {
      try {
         const redisInfo = await this.redis.getMemoryUsage();
         const cacheKeys = await this.redis.getKeyCount();

         return {
            ...this.stats,
            redisInfo,
            cacheKeys
         };
      } catch (error: any) {
         console.error('Get cache stats error:', error);
         return {
            ...this.stats,
            redisInfo: null,
            cacheKeys: 0
         };
      }
   }

   /**
    * Get cache entry metadata
    */
   async getCacheMetadata(key: string): Promise<CacheEntry | null> {
      try {
         const metadataKey = `${key}:meta`;
         const metadataStr = await this.redis.getClient().get(metadataKey);

         if (!metadataStr) {
            return null;
         }

         const metadata = JSON.parse(metadataStr);
         const content = await this.get(key);

         if (!content) {
            return null;
         }

         return {
            key,
            value: content,
            contentType: metadata.contentType,
            size: metadata.size,
            createdAt: new Date(metadata.createdAt),
            expiresAt: new Date(metadata.expiresAt)
         };
      } catch (error: any) {
         console.error('Get cache metadata error:', error);
         return null;
      }
   }

   /**
    * Update hit rate calculation
    */
   private updateHitRate(): void {
      if (this.stats.totalRequests > 0) {
         this.stats.hitRate = (this.stats.hits / this.stats.totalRequests) * 100;
      }
   }

   /**
    * Reset cache statistics
    */
   resetStats(): void {
      this.stats = {
         hits: 0,
         misses: 0,
         hitRate: 0,
         totalRequests: 0,
         cacheSize: 0
      };
   }

   /**
    * Test cache functionality
    */
   async testCache(): Promise<boolean> {
      try {
         const testKey = 'test:cache:key';
         const testValue = Buffer.from('test content', 'utf-8');

         // Test set
         const setResult = await this.set(testKey, testValue, 60);
         if (!setResult) {
            return false;
         }

         // Test get
         const getValue = await this.get(testKey);
         if (!getValue || !getValue.equals(testValue)) {
            return false;
         }

         // Test exists
         const exists = await this.exists(testKey);
         if (!exists) {
            return false;
         }

         // Test delete
         const deleteResult = await this.delete(testKey);
         if (!deleteResult) {
            return false;
         }

         // Verify deletion
         const deletedValue = await this.get(testKey);
         if (deletedValue) {
            return false;
         }

         return true;
      } catch (error: any) {
         console.error('Cache test failed:', error);
         return false;
      }
   }
}

/**
 * Cache factory for easy access
 */
export class StreamingCacheFactory {
   private static instance: StreamingCacheService | null = null;

   /**
    * Get cache service instance
    */
   public static getInstance(): StreamingCacheService {
      if (!StreamingCacheFactory.instance) {
         StreamingCacheFactory.instance = new StreamingCacheService();
      }
      return StreamingCacheFactory.instance;
   }

   /**
    * Reset instance (useful for testing)
    */
   public static resetInstance(): void {
      StreamingCacheFactory.instance = null;
   }
}
