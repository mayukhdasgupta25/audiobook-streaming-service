/**
 * Redis Configuration
 * Handles Redis connection and configuration for Bull queues
 */
import Redis from 'ioredis';
import { config } from './env';
import { redisLogger } from './logger';

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

   private constructor(redisConfig: RedisConfig) {
      const redisOptions: any = {
         host: redisConfig.host,
         port: redisConfig.port,
         db: redisConfig.db || 0,
         lazyConnect: redisConfig.lazyConnect || true,
      };

      if (redisConfig.password) {
         redisOptions.password = redisConfig.password;
      }

      this.redis = new Redis(redisOptions);

      this.setupEventHandlers();
   }

   public static getInstance(redisConfig?: RedisConfig): RedisConnection {
      if (!RedisConnection.instance) {
         const parsedConfig = redisConfig ?? RedisConfigHelper.getConfigFromEnv();
         RedisConnection.instance = new RedisConnection(parsedConfig);
      }

      return RedisConnection.instance;
   }

   public getClient(): Redis {
      return this.redis;
   }

   private setupEventHandlers(): void {
      this.redis.on('connect', () => {
         redisLogger.info('Redis connected successfully');
      });

      this.redis.on('ready', () => {
         redisLogger.info('Redis ready to accept commands');
      });

      this.redis.on('error', (error) => {
         redisLogger.error({ err: error }, 'Redis connection error');
      });

      this.redis.on('close', () => {
         redisLogger.warn('Redis connection closed');
      });

      this.redis.on('reconnecting', () => {
         redisLogger.info('Redis reconnecting...');
      });

      this.redis.on('end', () => {
         redisLogger.warn('Redis connection ended');
      });
   }

   public async testConnection(): Promise<boolean> {
      try {
         await this.redis.ping();
         return true;
      } catch (error) {
         redisLogger.error({ err: error }, 'Redis connection test failed');
         return false;
      }
   }

   public async getInfo(): Promise<string> {
      try {
         return await this.redis.info();
      } catch (error) {
         redisLogger.error({ err: error }, 'Failed to get Redis info');
         throw error;
      }
   }

   public async close(): Promise<void> {
      try {
         await this.redis.quit();
      } catch (error) {
         redisLogger.error({ err: error }, 'Error closing Redis connection');
      }
   }

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
         const memoryInfo: Record<string, string> = {};

         lines.forEach(line => {
            if (line.includes(':')) {
               const [key, value] = line.split(':');
               if (key) {
                  memoryInfo[key] = value ?? '';
               }
            }
         });

         return {
            usedMemory: memoryInfo['used_memory'] || '0',
            usedMemoryHuman: memoryInfo['used_memory_human'] || '0B',
            usedMemoryRss: memoryInfo['used_memory_rss'] || '0',
            usedMemoryPeak: memoryInfo['used_memory_peak'] || '0',
            usedMemoryPeakHuman: memoryInfo['used_memory_peak_human'] || '0B',
         };
      } catch (error) {
         redisLogger.error({ err: error }, 'Failed to get Redis memory usage');
         throw error;
      }
   }

   public async getKeyCount(): Promise<number> {
      try {
         return await this.redis.dbsize();
      } catch (error) {
         redisLogger.error({ err: error }, 'Failed to get Redis key count');
         throw error;
      }
   }

   public async clearAll(): Promise<void> {
      try {
         await this.redis.flushall();
         redisLogger.warn('All Redis data cleared');
      } catch (error) {
         redisLogger.error({ err: error }, 'Failed to clear Redis data');
         throw error;
      }
   }

   public async clearPattern(pattern: string): Promise<number> {
      try {
         const keys = await this.redis.keys(pattern);
         if (keys.length > 0) {
            await this.redis.del(...keys);
         }
         return keys.length;
      } catch (error) {
         redisLogger.error({ err: error, pattern }, 'Failed to clear pattern keys');
         throw error;
      }
   }
}

export class RedisConfigHelper {
   public static getConfigFromEnv(): RedisConfig {
      const redisUrl = new URL(config.REDIS_URL);
      const dbPath = redisUrl.pathname.replace(/^\//, '');
      const parsedDb = dbPath ? parseInt(dbPath, 10) : 0;

      return {
         host: redisUrl.hostname,
         port: parseInt(redisUrl.port || '6379', 10),
         password: config.REDIS_PASSWORD || undefined,
         db: Number.isNaN(parsedDb) ? 0 : parsedDb,
         lazyConnect: true,
      };
   }

   public static validateConfig(redisConfig: RedisConfig): boolean {
      if (!redisConfig.host || !redisConfig.port) {
         return false;
      }

      if (redisConfig.port < 1 || redisConfig.port > 65535) {
         return false;
      }

      if (redisConfig.db && (redisConfig.db < 0 || redisConfig.db > 15)) {
         return false;
      }

      return true;
   }

   public static getRedisUrl(redisConfig: RedisConfig): string {
      const auth = redisConfig.password ? `:${redisConfig.password}@` : '';
      const db = redisConfig.db ? `/${redisConfig.db}` : '';
      return `redis://${auth}${redisConfig.host}:${redisConfig.port}${db}`;
   }
}
