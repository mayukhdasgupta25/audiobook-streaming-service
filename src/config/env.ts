import dotenv from 'dotenv';
import path from 'path';

const LOCALHOST_PATTERN = /localhost|127\.0\.0\.1/i;

const ENV_FILE_BY_NODE_ENV: Record<string, string | null> = {
   development: '.env.development',
   test: null,
   testing: '.env.testing',
   staging: '.env.staging',
   production: '.env.production',
};

function getEnvFileForBootstrap(): string | null {
   const bootstrapEnv = process.env['NODE_ENV'] ?? 'development';
   return ENV_FILE_BY_NODE_ENV[bootstrapEnv] ?? `.env.${bootstrapEnv}`;
}

function loadEnvFiles(): void {
   const envFile = getEnvFileForBootstrap();
   if (envFile) {
      dotenv.config({ path: path.resolve(process.cwd(), envFile) });
   }
}

function requireEnv(key: string): string {
   const value = process.env[key];
   if (value === undefined) {
      throw new Error(`Missing required environment variable: ${key}`);
   }
   return value;
}

function requireIntEnv(key: string): number {
   const raw = requireEnv(key);
   const parsed = parseInt(raw, 10);
   if (Number.isNaN(parsed)) {
      throw new Error(`Environment variable ${key} must be a valid integer`);
   }
   return parsed;
}

function parseTranscodingBitrates(raw: string): number[] {
   const envValue = raw.trim();

   if (envValue.startsWith('[') && envValue.endsWith(']')) {
      try {
         const parsed = JSON.parse(envValue);
         if (Array.isArray(parsed)) {
            const bitrates = parsed
               .map(b => (typeof b === 'number' ? b : parseInt(String(b), 10)))
               .filter(b => !Number.isNaN(b) && b > 0);
            if (bitrates.length > 0) {
               return bitrates;
            }
         }
      } catch {
         // Fall through to comma-separated parsing
      }
   }

   const bitrates = envValue
      .split(',')
      .map(b => b.trim())
      .filter(b => b.length > 0)
      .map(b => parseInt(b, 10))
      .filter(b => !Number.isNaN(b) && b > 0);

   if (bitrates.length === 0) {
      throw new Error('TRANSCODING_BITRATES must contain at least one valid positive integer');
   }

   return bitrates;
}

function assertNoLocalhost(envVar: string, value: string, nodeEnv: string): void {
   if (LOCALHOST_PATTERN.test(value)) {
      throw new Error(`${envVar} must not reference localhost in ${nodeEnv}`);
   }
}

function validateNoLocalhostInStagingOrProduction(
   nodeEnv: string,
   values: {
      DATABASE_URL: string;
      REDIS_URL: string;
      RABBITMQ_URL: string;
      STREAMING_BASE_URL: string;
      AUTH_SERVICE_URL: string;
      JWKS_ENDPOINT: string;
   }
): void {
   if (nodeEnv !== 'staging' && nodeEnv !== 'production') {
      return;
   }

   assertNoLocalhost('DATABASE_URL', values.DATABASE_URL, nodeEnv);
   assertNoLocalhost('REDIS_URL', values.REDIS_URL, nodeEnv);
   assertNoLocalhost('RABBITMQ_URL', values.RABBITMQ_URL, nodeEnv);
   assertNoLocalhost('STREAMING_BASE_URL', values.STREAMING_BASE_URL, nodeEnv);
   assertNoLocalhost('AUTH_SERVICE_URL', values.AUTH_SERVICE_URL, nodeEnv);
   assertNoLocalhost('JWKS_ENDPOINT', values.JWKS_ENDPOINT, nodeEnv);
}

loadEnvFiles();

const nodeEnv = requireEnv('NODE_ENV');

const DATABASE_URL = requireEnv('DATABASE_URL');
const REDIS_URL = requireEnv('REDIS_URL');
const RABBITMQ_URL = requireEnv('RABBITMQ_URL');
const STREAMING_BASE_URL = requireEnv('STREAMING_BASE_URL');
const AUTH_SERVICE_URL = requireEnv('AUTH_SERVICE_URL');
const JWKS_ENDPOINT = requireEnv('JWKS_ENDPOINT');
const STORAGE_PROVIDER = requireEnv('STORAGE_PROVIDER');

validateNoLocalhostInStagingOrProduction(nodeEnv, {
   DATABASE_URL,
   REDIS_URL,
   RABBITMQ_URL,
   STREAMING_BASE_URL,
   AUTH_SERVICE_URL,
   JWKS_ENDPOINT,
});

if (nodeEnv !== 'development' && STORAGE_PROVIDER !== 's3') {
   throw new Error(`STORAGE_PROVIDER must be s3 when NODE_ENV is ${nodeEnv}`);
}

const USE_SECURE_COOKIES = nodeEnv === 'production' || nodeEnv === 'staging' || nodeEnv === 'testing';

export const config = {
   NODE_ENV: nodeEnv,
   PORT: requireIntEnv('PORT'),
   TRUST_PROXY: requireIntEnv('TRUST_PROXY'),
   USE_SECURE_COOKIES,
   SESSION_SECRET: requireEnv('SESSION_SECRET'),

   DATABASE_URL,
   REDIS_URL,
   REDIS_PASSWORD: requireEnv('REDIS_PASSWORD'),

   RABBITMQ_URL,
   RABBITMQ_MESSAGE_TTL: requireIntEnv('RABBITMQ_MESSAGE_TTL'),

   BULL_REDIS_HOST: requireEnv('BULL_REDIS_HOST'),
   BULL_JOB_TIMEOUT: requireIntEnv('BULL_JOB_TIMEOUT'),
   BULL_MAX_ATTEMPTS: requireIntEnv('BULL_MAX_ATTEMPTS'),
   BULL_BACKOFF_DELAY: requireIntEnv('BULL_BACKOFF_DELAY'),

   STORAGE_PROVIDER,
   LOCAL_STORAGE_PATH: requireEnv('LOCAL_STORAGE_PATH'),
   AWS_S3_BUCKET: requireEnv('AWS_S3_BUCKET'),
   AWS_S3_REGION: requireEnv('AWS_S3_REGION'),
   AWS_ACCESS_KEY_ID: requireEnv('AWS_ACCESS_KEY_ID'),
   AWS_SECRET_ACCESS_KEY: requireEnv('AWS_SECRET_ACCESS_KEY'),
   AWS_S3_ENDPOINT: requireEnv('AWS_S3_ENDPOINT'),
   AWS_SIGNED_URL_EXPIRES_IN: requireIntEnv('AWS_SIGNED_URL_EXPIRES_IN'),

   FFMPEG_PATH: requireEnv('FFMPEG_PATH'),
   FFPROBE_PATH: requireEnv('FFPROBE_PATH'),

   HLS_SEGMENT_DURATION: requireIntEnv('HLS_SEGMENT_DURATION'),
   TRANSCODING_BITRATES: parseTranscodingBitrates(requireEnv('TRANSCODING_BITRATES')),
   STREAMING_CACHE_TTL: requireIntEnv('STREAMING_CACHE_TTL'),
   STREAMING_BASE_URL,

   RATE_LIMIT_WINDOW_MS: requireIntEnv('RATE_LIMIT_WINDOW_MS'),
   RATE_LIMIT_MAX_REQUESTS: requireIntEnv('RATE_LIMIT_MAX_REQUESTS'),

   LOG_LEVEL: requireEnv('LOG_LEVEL'),
   LOG_DIR: requireEnv('LOG_DIR'),

   HEALTH_CHECK_INTERVAL: requireIntEnv('HEALTH_CHECK_INTERVAL'),
   TRANSCODING_TIMEOUT: requireIntEnv('TRANSCODING_TIMEOUT'),
   MAX_TRANSCODING_WORKERS: requireIntEnv('MAX_TRANSCODING_WORKERS'),
   CACHE_TTL: requireIntEnv('CACHE_TTL'),

   AUTH_SERVICE_URL,
   JWKS_ENDPOINT,
};
