/**
 * Redis Configuration
 * Handles Redis connection and configuration for Bull queues
 */
import Redis from 'ioredis';

export interface RedisConfig {
   host: string;
   port: number;
   password?: string | undefined;
   db?: number;
   lazyConnect?: boolean;
}

export class RedisConnection {
   private static instance: RedisConnection;
   private redis: Redis;

   private constructor(config: RedisConfig) {
      const redisOptions: any = {
         host: config.host,
         port: config.port,
         db: config.db || 0,
         lazyConnect: config.lazyConnect || true,
      };

      if (config.password) {
         redisOptions.password = config.password;
      }

      this.redis = new Redis(redisOptions);

      this.setupEventHandlers();
   }

   /**
    * Get Redis connection instance
    */
   public static getInstance(config?: RedisConfig): RedisConnection {
      if (!RedisConnection.instance) {
         const defaultConfig: RedisConfig = {
            host: process.env['REDIS_HOST'] || 'localhost',
            port: parseInt(process.env['REDIS_PORT'] || '6379'),
            password: process.env['REDIS_PASSWORD'] || undefined,
            db: parseInt(process.env['REDIS_DB'] || '0'),
            lazyConnect: process.env['REDIS_LAZY_CONNECT'] === 'true',
         };

         RedisConnection.instance = new RedisConnection(config || defaultConfig);
      }

      return RedisConnection.instance;
   }

   /**
    * Get Redis client
    */
   public getClient(): Redis {
      return this.redis;
   }

   /**
    * Setup Redis event handlers
    */
   private setupEventHandlers(): void {
      this.redis.on('connect', () => {
         console.log('Redis connected successfully');
      });

      this.redis.on('ready', () => {
         console.log('Redis ready to accept commands');
      });

      this.redis.on('error', (error) => {
         console.error('Redis connection error:', error);
      });

      this.redis.on('close', () => {
         console.log('Redis connection closed');
      });

      this.redis.on('reconnecting', () => {
         console.log('Redis reconnecting...');
      });

      this.redis.on('end', () => {
         console.log('Redis connection ended');
      });
   }

   /**
    * Test Redis connection
    */
   public async testConnection(): Promise<boolean> {
      try {
         await this.redis.ping();
         return true;
      } catch (error) {
         console.error('Redis connection test failed:', error);
         return false;
      }
   }

   /**
    * Get Redis info
    */
   public async getInfo(): Promise<string> {
      try {
         return await this.redis.info();
      } catch (error) {
         console.error('Failed to get Redis info:', error);
         throw error;
      }
   }

   /**
    * Close Redis connection
    */
   public async close(): Promise<void> {
      try {
         await this.redis.quit();
      } catch (error) {
         console.error('Error closing Redis connection:', error);
      }
   }

   /**
    * Get Redis memory usage
    */
   public async getMemoryUsage(): Promise<{
      usedMemory: string;
      usedMemoryHuman: string;
      usedMemoryRss: string;
      usedMemoryPeak: string;
      usedMemoryPeakHuman: string;
   }> {
      try {
         const info = await this.redis.info('memory');
         const lines = info.split('\r\n');
         const memoryInfo: any = {};

         lines.forEach(line => {
            if (line.includes(':')) {
               const [key, value] = line.split(':');
               if (key) {
                  memoryInfo[key] = value;
               }
            }
         });

         return {
            usedMemory: memoryInfo.used_memory || '0',
            usedMemoryHuman: memoryInfo.used_memory_human || '0B',
            usedMemoryRss: memoryInfo.used_memory_rss || '0',
            usedMemoryPeak: memoryInfo.used_memory_peak || '0',
            usedMemoryPeakHuman: memoryInfo.used_memory_peak_human || '0B',
         };
      } catch (error) {
         console.error('Failed to get Redis memory usage:', error);
         throw error;
      }
   }

   /**
    * Get Redis key count
    */
   public async getKeyCount(): Promise<number> {
      try {
         return await this.redis.dbsize();
      } catch (error) {
         console.error('Failed to get Redis key count:', error);
         throw error;
      }
   }

   /**
    * Clear all Redis data (use with caution)
    */
   public async clearAll(): Promise<void> {
      try {
         await this.redis.flushall();
         console.log('All Redis data cleared');
      } catch (error) {
         console.error('Failed to clear Redis data:', error);
         throw error;
      }
   }

   /**
    * Clear specific pattern keys
    */
   public async clearPattern(pattern: string): Promise<number> {
      try {
         const keys = await this.redis.keys(pattern);
         if (keys.length > 0) {
            await this.redis.del(...keys);
         }
         return keys.length;
      } catch (error) {
         console.error('Failed to clear pattern keys:', error);
         throw error;
      }
   }
}

/**
 * Redis configuration helper
 */
export class RedisConfigHelper {
   /**
    * Get Redis configuration from environment variables
    */
   public static getConfigFromEnv(): RedisConfig {
      return {
         host: process.env['REDIS_HOST'] || 'localhost',
         port: parseInt(process.env['REDIS_PORT'] || '6379'),
         password: process.env['REDIS_PASSWORD'] || undefined,
         db: parseInt(process.env['REDIS_DB'] || '0'),
         lazyConnect: process.env['REDIS_LAZY_CONNECT'] === 'true',
      };
   }

   /**
    * Validate Redis configuration
    */
   public static validateConfig(config: RedisConfig): boolean {
      if (!config.host || !config.port) {
         return false;
      }

      if (config.port < 1 || config.port > 65535) {
         return false;
      }

      if (config.db && (config.db < 0 || config.db > 15)) {
         return false;
      }

      return true;
   }

   /**
    * Get Redis URL from configuration
    */
   public static getRedisUrl(config: RedisConfig): string {
      const auth = config.password ? `:${config.password}@` : '';
      const db = config.db ? `/${config.db}` : '';
      return `redis://${auth}${config.host}:${config.port}${db}`;
   }
}
