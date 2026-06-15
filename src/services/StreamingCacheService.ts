/**
 * Streaming Cache Service
 * Redis-based caching for HLS playlists and segments
 */
import { RedisConnection } from '../config/redis';
import { StorageProvider } from './storage/StorageProvider';
import { StorageFactory } from './storage/StorageFactory';
import { config } from '../config/env';
import { toStorageKey } from '../utils/storageKeys';
import { isDevelopmentStreaming } from '../utils/streamingStorage';
import { redisLogger } from '../config/logger';

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
         redisLogger.error({ err: error }, 'Cache get error');
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
         redisLogger.error({ err: error }, 'Cache set error');
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
         redisLogger.error({ err: error }, 'Cache delete error');
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
         redisLogger.error({ err: error }, 'Cache exists error');
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
            redisLogger.error({ err: storageError }, 'Storage fallback error');
            return null;
         }
      } catch (error: any) {
         redisLogger.error({ err: error }, 'Get with fallback error');
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
      if (!isDevelopmentStreaming()) {
         return true;
      }

      try {
         const key = isMaster
            ? `stream:playlist:${chapterId}:master`
            : `stream:playlist:${chapterId}:${bitrate}`;

         const content = Buffer.from(playlistContent, 'utf-8');
         const contentType = 'application/vnd.apple.mpegurl';
         const ttl = Math.min(
            config.STREAMING_CACHE_TTL,
            Math.max(60, config.HLS_PRESIGNED_URL_EXPIRES_IN - 300),
         );

         return await this.set(key, content, ttl, contentType);
      } catch (error: any) {
         redisLogger.error({ err: error }, 'Cache playlist error');
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
      if (!isDevelopmentStreaming()) {
         return null;
      }

      try {
         const key = isMaster
            ? `stream:playlist:${chapterId}:master`
            : `stream:playlist:${chapterId}:${bitrate}`;

         const content = await this.get(key);
         return content ? content.toString('utf-8') : null;
      } catch (error: any) {
         redisLogger.error({ err: error }, 'Get cached playlist error');
         return null;
      }
   }

   /**
    * Cache HLS segment
    */
   async cacheSegment(
      chapterId: string,
      bitrate: number,
      segmentId: string,
      segmentContent: Buffer
   ): Promise<boolean> {
      try {
         const key = `stream:segment:${chapterId}:${bitrate}:${segmentId}`;
         // Determine content type based on segment extension
         const contentType = segmentId.endsWith('.m4s') || segmentId.endsWith('.mp4') ? 'video/mp4' : 'video/mp2t';

         return await this.set(key, segmentContent, config.STREAMING_CACHE_TTL, contentType);
      } catch (error: any) {
         redisLogger.error({ err: error }, 'Cache segment error');
         return false;
      }
   }

   /**
    * Get cached HLS segment
    */
   async getCachedSegment(
      chapterId: string,
      bitrate: number,
      segmentId: string
   ): Promise<Buffer | null> {
      try {
         const key = `stream:segment:${chapterId}:${bitrate}:${segmentId}`;
         return await this.get(key);
      } catch (error: any) {
         redisLogger.error({ err: error }, 'Get cached segment error');
         return null;
      }
   }

   /**
    * Get segment with fallback to storage
    */
   async getSegmentWithFallback(
      chapterId: string,
      bitrate: number,
      segmentId: string,
      storagePath: string
   ): Promise<Buffer | null> {
      try {
         const key = `stream:segment:${chapterId}:${bitrate}:${segmentId}`;
         // Determine content type based on segment extension
         const contentType = segmentId.endsWith('.m4s') || segmentId.endsWith('.mp4') ? 'video/mp4' : 'video/mp2t';

         return await this.getWithFallback(key, storagePath, contentType);
      } catch (error: any) {
         redisLogger.error({ err: error }, 'Get segment with fallback error');
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
            // Try .m4s first (fMP4), fallback to .ts (legacy)
            const segmentIdM4s = `segment_${i.toString().padStart(3, '0')}.m4s`;
            const segmentIdTs = `segment_${i.toString().padStart(3, '0')}.ts`;
            const storagePathM4s = toStorageKey(`bit_transcode/${chapterId}/${bitrate}k/${segmentIdM4s}`);
            const storagePathTs = toStorageKey(`bit_transcode/${chapterId}/${bitrate}k/${segmentIdTs}`);

            try {
               // Try to load .m4s segment first
               let segmentContent: Buffer | null = null;
               let segmentId: string = segmentIdM4s;

               try {
                  segmentContent = await this.storageProvider.downloadFile(storagePathM4s);
               } catch {
                  // Fallback to .ts if .m4s doesn't exist
                  try {
                     segmentContent = await this.storageProvider.downloadFile(storagePathTs);
                     segmentId = segmentIdTs;
                  } catch {
                     // Skip if neither exists
                     continue;
                  }
               }

               if (segmentContent) {
                  await this.cacheSegment(chapterId, bitrate, segmentId, segmentContent);
                  loadedCount++;
               }
            } catch (error: any) {
               redisLogger.error({ err: error, segmentIdM4s, segmentIdTs }, 'Failed to preload segment');
            }
         }
      } catch (error: any) {
         redisLogger.error({ err: error }, 'Preload chapter segments error');
      }

      redisLogger.info({ chapterId, bitrate, loadedCount, segmentCount }, 'Preloaded segments for chapter');
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

         redisLogger.info({ chapterId, count: keys.length }, 'Cleared cache entries for chapter');
         return keys.length;
      } catch (error: any) {
         redisLogger.error({ err: error }, 'Clear chapter cache error');
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

         redisLogger.info({ count: keys.length }, 'Cleared cache entries');
         return keys.length;
      } catch (error: any) {
         redisLogger.error({ err: error }, 'Clear all cache error');
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
         redisLogger.error({ err: error }, 'Get cache stats error');
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
         redisLogger.error({ err: error }, 'Get cache metadata error');
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
         redisLogger.error({ err: error }, 'Cache test failed');
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
