import dotenv from 'dotenv';
import path from 'path';

const nodeEnv = process.env.NODE_ENV || 'development';
const envFile = `.env${nodeEnv !== 'development' ? `.${nodeEnv}` : ''}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

/**
 * Environment configuration for the streaming service
 * Provides type-safe access to environment variables with defaults
 */
// Construct DATABASE_URL if not provided directly
const getDatabaseUrl = (): string => {
   if (process.env.DATABASE_URL) {
      return process.env.DATABASE_URL;
   }
   // Construct from individual DB variables
   const host = process.env['DB_HOST'] || 'localhost';
   const port = process.env['DB_PORT'] || '5432';
   const name = process.env['DB_NAME'] || 'streaming_dev';
   const user = process.env['DB_USER'] || 'postgres';
   const password = process.env['DB_PASSWORD'] || '';
   return `postgresql://${user}:${password}@${host}:${port}/${name}`;
};

// Set DATABASE_URL for Prisma Migrate and other tools
if (!process.env.DATABASE_URL) {
   process.env.DATABASE_URL = getDatabaseUrl();
}

export const config = {
   // Server configuration
   NODE_ENV: nodeEnv,
   STREAMING_PORT: parseInt(process.env.STREAMING_PORT || '8082', 10),
   DB_HOST: process.env['DB_HOST'] || 'localhost',
   DB_PORT: parseInt(process.env['DB_PORT'] || '5432', 10),
   DB_NAME: process.env['DB_NAME'] || 'streaming_dev',
   DB_USER: process.env['DB_USER'] || 'postgres',
   DB_PASSWORD: process.env['DB_PASSWORD'] || '',
   DATABASE_URL: process.env.DATABASE_URL,

   // Client configuration
   CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:8081',

   // Redis configuration
   REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
   REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,

   // RabbitMQ configuration
   RABBITMQ_URL: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
   RABBITMQ_MESSAGE_TTL: parseInt(process.env.RABBITMQ_MESSAGE_TTL || '3600000', 10), // Message TTL in milliseconds (default: 1 hour)

   // Bull Queue configuration
   BULL_REDIS_HOST: process.env.BULL_REDIS_HOST || process.env.REDIS_URL || 'redis://localhost:6379',
   BULL_JOB_TIMEOUT: parseInt(process.env.BULL_JOB_TIMEOUT || '3600000', 10), // 1 hour
   BULL_MAX_ATTEMPTS: parseInt(process.env.BULL_MAX_ATTEMPTS || '3', 10),
   BULL_BACKOFF_DELAY: parseInt(process.env.BULL_BACKOFF_DELAY || '30000', 10), // 30 seconds

   // Storage configuration
   // Storage provider selection
   STORAGE_PROVIDER: process.env['STORAGE_PROVIDER'] || 'local', // local, s3

   // AWS S3 configuration (if using S3 storage)
   AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || '',
   AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || '',
   AWS_REGION: process.env.AWS_REGION || 'us-east-1',
   AWS_S3_BUCKET: process.env.AWS_S3_BUCKET || '',

   // FFmpeg configuration
   FFMPEG_PATH: process.env.FFMPEG_PATH || 'ffmpeg',
   FFPROBE_PATH: process.env.FFPROBE_PATH || 'ffprobe',

   // Streaming configuration
   HLS_SEGMENT_DURATION: parseInt(process.env['HLS_SEGMENT_DURATION'] || '10', 10), // seconds
   TRANSCODING_BITRATES: process.env['TRANSCODING_BITRATES']?.split(',').map(b => parseInt(b, 10)) || [64, 128, 256], // kbps
   STREAMING_CACHE_TTL: parseInt(process.env['STREAMING_CACHE_TTL'] || '3600', 10), // seconds

   // Rate limiting
   RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
   RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),

   // Logging
   LOG_LEVEL: process.env.LOG_LEVEL || 'info',
   LOG_FORMAT: process.env.LOG_FORMAT || 'combined',

   // CORS configuration
   CORS_ORIGINS: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:8081'],

   // Health check configuration
   HEALTH_CHECK_INTERVAL: parseInt(process.env.HEALTH_CHECK_INTERVAL || '30000', 10), // 30 seconds

   // Transcoding configuration
   TRANSCODING_TIMEOUT: parseInt(process.env.TRANSCODING_TIMEOUT || '3600000', 10), // 1 hour
   MAX_TRANSCODING_WORKERS: parseInt(process.env.MAX_TRANSCODING_WORKERS || '2', 10),

   // Cache configuration
   CACHE_TTL: parseInt(process.env.CACHE_TTL || '3600', 10), // 1 hour

   // File upload limits
   MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE || '104857600', 10), // 100MB
   ALLOWED_AUDIO_FORMATS: process.env.ALLOWED_AUDIO_FORMATS || 'mp3,wav,flac,aac,m4a',

   // Analytics configuration
   ANALYTICS_ENABLED: process.env.ANALYTICS_ENABLED === 'true',
   ANALYTICS_RETENTION_DAYS: parseInt(process.env.ANALYTICS_RETENTION_DAYS || '30', 10),
};
