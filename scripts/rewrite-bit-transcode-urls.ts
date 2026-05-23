/**
 * Rewrite absolute URLs in local bit_transcode HLS playlists to the current base URL.
 * Also invalidates Redis playlist cache keys for affected chapters.
 *
 * Usage:
 *   npx ts-node scripts/rewrite-bit-transcode-urls.ts
 *   npx ts-node scripts/rewrite-bit-transcode-urls.ts --chapter-id <id> --dry-run
 *   npx ts-node scripts/rewrite-bit-transcode-urls.ts --base-url http://127.0.0.1:8083
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
import Redis from 'ioredis';

const ABSOLUTE_BIT_TRANSCODE_PATTERN = /https?:\/\/[^/\s"']+\/bit_transcode\//g;

interface CliOptions {
   baseUrl?: string;
   chapterId?: string;
   dryRun: boolean;
   skipRedis: boolean;
}

interface RewriteResult {
   filePath: string;
   chapterId: string;
   bitrates: number[];
   changed: boolean;
   beforeSample?: string;
   afterSample?: string;
}

function loadEnv(): void {
   const cwd = process.cwd();
   // Always load .env first (STREAMING_BASE_URL, STREAMING_PORT, etc.)
   dotenv.config({ path: path.resolve(cwd, '.env') });

   const nodeEnv = process.env.NODE_ENV || 'development';
   if (nodeEnv !== 'development') {
      dotenv.config({ path: path.resolve(cwd, `.env.${nodeEnv}`) });
   }

   // Local overrides (e.g. .env.local) take precedence
   dotenv.config({ path: path.resolve(cwd, '.env.local') });
}

function parseArgs(argv: string[]): CliOptions {
   const options: CliOptions = {
      dryRun: false,
      skipRedis: false
   };

   for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '--dry-run') {
         options.dryRun = true;
      } else if (arg === '--skip-redis') {
         options.skipRedis = true;
      } else if (arg === '--base-url' && argv[i + 1]) {
         options.baseUrl = argv[++i];
      } else if (arg === '--chapter-id' && argv[i + 1]) {
         options.chapterId = argv[++i];
      }
   }

   return options;
}

function resolveTargetBaseUrl(override?: string): string {
   if (override) {
      return override.replace(/\/+$/, '');
   }

   const fromEnv = process.env.STREAMING_BASE_URL?.trim();
   if (fromEnv) {
      return fromEnv.replace(/\/+$/, '');
   }

   const port = parseInt(
      process.env.STREAMING_PORT || process.env.PORT || '8083',
      10
   );
   return `http://localhost:${port}`;
}

function rewritePlaylistContent(
   content: string,
   targetBase: string,
   chapterId: string,
   bitrate: number | null
): string {
   let updated = content.replace(
      ABSOLUTE_BIT_TRANSCODE_PATTERN,
      `${targetBase}/bit_transcode/`
   );

   if (bitrate === null) {
      return updated;
   }

   const segmentsBasePath = `bit_transcode/${chapterId}/${bitrate}k`;

   updated = updated.replace(
      /#EXT-X-MAP:URI="([^"]+)"/g,
      (match, uri: string) => {
         if (uri.startsWith('http://') || uri.startsWith('https://')) {
            return match;
         }
         const absoluteUri = uri === 'init.mp4'
            ? `${targetBase}/${segmentsBasePath}/init.mp4`
            : `${targetBase}/${segmentsBasePath}/${uri}`;
         return `#EXT-X-MAP:URI="${absoluteUri}"`;
      }
   );

   updated = updated.split('\n').map((line) => {
      const trimmed = line.trim();
      if (
         !trimmed
         || trimmed.startsWith('#')
         || trimmed.startsWith('http://')
         || trimmed.startsWith('https://')
      ) {
         return line;
      }
      if (trimmed.endsWith('.m4s') || trimmed.endsWith('.ts')) {
         return `${targetBase}/${segmentsBasePath}/${trimmed}`;
      }
      return line;
   }).join('\n');

   return updated;
}

async function findPlaylistFiles(
   roots: string[],
   chapterFilter?: string
): Promise<string[]> {
   const files: string[] = [];

   for (const root of roots) {
      const rootPath = path.join(process.cwd(), root);
      try {
         await fs.access(rootPath);
      } catch {
         console.warn(`Skipping missing directory: ${rootPath}`);
         continue;
      }

      const chapterEntries = await fs.readdir(rootPath, { withFileTypes: true });
      for (const chapterEntry of chapterEntries) {
         if (!chapterEntry.isDirectory()) {
            continue;
         }

         const chapterId = chapterEntry.name;
         if (chapterFilter && chapterId !== chapterFilter) {
            continue;
         }

         const chapterPath = path.join(rootPath, chapterId);

         const masterPath = path.join(chapterPath, 'master.m3u8');
         try {
            await fs.access(masterPath);
            files.push(masterPath);
         } catch {
            // no master playlist
         }

         const bitrateEntries = await fs.readdir(chapterPath, { withFileTypes: true });
         for (const bitrateEntry of bitrateEntries) {
            if (!bitrateEntry.isDirectory()) {
               continue;
            }

            const playlistPath = path.join(chapterPath, bitrateEntry.name, 'playlist.m3u8');
            try {
               await fs.access(playlistPath);
               files.push(playlistPath);
            } catch {
               // no variant playlist
            }
         }
      }
   }

   return files;
}

function extractChapterAndBitrate(filePath: string): {
   chapterId: string;
   bitrate: number | null;
} {
   const normalized = filePath.replace(/\\/g, '/');
   const match = normalized.match(/bit_transcode\/([^/]+)(?:\/(\d+)k)?\/(?:playlist|master)\.m3u8$/);
   if (!match) {
      throw new Error(`Could not parse chapter/bitrate from path: ${filePath}`);
   }

   return {
      chapterId: match[1],
      bitrate: match[2] ? parseInt(match[2], 10) : null
   };
}

function collectBitratesForChapter(filePath: string, bitrates: Set<number>): void {
   const normalized = filePath.replace(/\\/g, '/');
   const match = normalized.match(/bit_transcode\/[^/]+\/(\d+)k\/playlist\.m3u8$/);
   if (match) {
      bitrates.add(parseInt(match[1], 10));
   }
}

async function processPlaylistFile(
   filePath: string,
   targetBase: string,
   dryRun: boolean
): Promise<RewriteResult> {
   const { chapterId, bitrate } = extractChapterAndBitrate(filePath);
   const original = await fs.readFile(filePath, 'utf-8');
   const rewritten = rewritePlaylistContent(original, targetBase, chapterId, bitrate);
   const changed = original !== rewritten;

   let beforeSample: string | undefined;
   let afterSample: string | undefined;

   if (changed) {
      const sampleLine = original.split('\n').find((l) => l.includes('http') || l.endsWith('.m4s') || l.endsWith('.ts'));
      const newSampleLine = rewritten.split('\n').find((l) => l.includes('http') || l.endsWith('.m4s') || l.endsWith('.ts'));
      beforeSample = sampleLine?.trim();
      afterSample = newSampleLine?.trim();

      if (!dryRun) {
         await fs.writeFile(filePath, rewritten, 'utf-8');
      }
   }

   return {
      filePath,
      chapterId,
      bitrates: bitrate !== null ? [bitrate] : [],
      changed,
      beforeSample,
      afterSample
   };
}

function createRedisClient(): Redis {
   const redisUrl = process.env.REDIS_URL;
   if (redisUrl) {
      return new Redis(redisUrl);
   }

   const options: { host: string; port: number; password?: string; db?: number } = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10)
   };

   if (process.env.REDIS_PASSWORD) {
      options.password = process.env.REDIS_PASSWORD;
   }
   if (process.env.REDIS_DB) {
      options.db = parseInt(process.env.REDIS_DB, 10);
   }

   return new Redis(options);
}

async function discoverChapterBitrates(
   roots: string[],
   chapterIds: Iterable<string>
): Promise<Map<string, Set<number>>> {
   const result = new Map<string, Set<number>>();

   for (const chapterId of chapterIds) {
      result.set(chapterId, new Set());
   }

   for (const root of roots) {
      const rootPath = path.join(process.cwd(), root);
      try {
         await fs.access(rootPath);
      } catch {
         continue;
      }

      for (const chapterId of chapterIds) {
         const chapterPath = path.join(rootPath, chapterId);
         try {
            const entries = await fs.readdir(chapterPath, { withFileTypes: true });
            for (const entry of entries) {
               if (!entry.isDirectory()) {
                  continue;
               }
               const match = entry.name.match(/^(\d+)k$/);
               if (match) {
                  result.get(chapterId)!.add(parseInt(match[1], 10));
               }
            }
         } catch {
            // chapter dir missing in this root
         }
      }
   }

   return result;
}

async function invalidateRedisPlaylistCache(
   chapterBitrates: Map<string, Set<number>>
): Promise<number> {
   const redis = createRedisClient();
   let deleted = 0;

   try {
      for (const [chapterId, bitrates] of chapterBitrates) {
         const masterKey = `stream:playlist:${chapterId}:master`;
         deleted += await redis.del(masterKey);

         const bitratesToClear = bitrates.size > 0
            ? [...bitrates]
            : [64, 128, 256];

         for (const bitrate of bitratesToClear) {
            const key = `stream:playlist:${chapterId}:${bitrate}`;
            deleted += await redis.del(key);
         }
      }
   } finally {
      await redis.quit();
   }

   return deleted;
}

async function main(): Promise<void> {
   loadEnv();
   const options = parseArgs(process.argv.slice(2));
   const targetBase = resolveTargetBaseUrl(options.baseUrl);
   if (!options.baseUrl && !process.env.STREAMING_BASE_URL?.trim()) {
      console.warn(
         'STREAMING_BASE_URL is not set in .env; using fallback:',
         targetBase
      );
   }

   const roots = ['storage/bit_transcode', 'bit_transcode'];
   const playlistFiles = await findPlaylistFiles(roots, options.chapterId);

   if (playlistFiles.length === 0) {
      console.log('No playlist files found.');
      return;
   }

   console.log(`Target base URL: ${targetBase}`);
   console.log(`Mode: ${options.dryRun ? 'dry-run' : 'write'}`);
   console.log(`Files to scan: ${playlistFiles.length}\n`);

   let updated = 0;
   let unchanged = 0;
   let firstChangeLogged = false;
   const chapterBitrates = new Map<string, Set<number>>();

   for (const filePath of playlistFiles) {
      const result = await processPlaylistFile(filePath, targetBase, options.dryRun);

      if (!chapterBitrates.has(result.chapterId)) {
         chapterBitrates.set(result.chapterId, new Set());
      }
      collectBitratesForChapter(filePath, chapterBitrates.get(result.chapterId)!);
      for (const b of result.bitrates) {
         chapterBitrates.get(result.chapterId)!.add(b);
      }

      if (result.changed) {
         updated++;
         console.log(`[updated] ${path.relative(process.cwd(), result.filePath)}`);
         if (!firstChangeLogged && result.beforeSample && result.afterSample) {
            console.log(`  before: ${result.beforeSample}`);
            console.log(`  after:  ${result.afterSample}`);
            firstChangeLogged = true;
         }
      } else {
         unchanged++;
      }
   }

   console.log(`\nDisk summary: ${playlistFiles.length} scanned, ${updated} updated, ${unchanged} unchanged`);

   if (options.dryRun) {
      console.log('Redis cache invalidation skipped (dry-run).');
      return;
   }

   if (options.skipRedis) {
      console.log('Redis cache invalidation skipped (--skip-redis).');
      return;
   }

   const chapterIds = [...chapterBitrates.keys()];
   if (chapterIds.length === 0) {
      console.log('No chapters to invalidate in Redis.');
      return;
   }

   const bitratesForRedis = await discoverChapterBitrates(roots, chapterIds);
   for (const [chapterId, bitrates] of bitratesForRedis) {
      const existing = chapterBitrates.get(chapterId);
      if (existing) {
         for (const b of existing) {
            bitrates.add(b);
         }
      }
   }

   try {
      const deleted = await invalidateRedisPlaylistCache(bitratesForRedis);
      console.log(`Redis: deleted ${deleted} playlist cache key(s) for ${bitratesForRedis.size} chapter(s).`);
      for (const [chapterId, bitrates] of bitratesForRedis) {
         const list = bitrates.size > 0 ? [...bitrates].sort((a, b) => a - b).join(', ') : '64, 128, 256 (fallback)';
         console.log(`  - ${chapterId}: bitrates [${list}]`);
      }
   } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Redis cache invalidation failed (disk rewrite still applied): ${message}`);
   }
}

main().catch((error: unknown) => {
   const message = error instanceof Error ? error.message : String(error);
   console.error('Script failed:', message);
   process.exit(1);
});
