/**
 * Environment-aware HLS storage paths and presigned URL helpers.
 */
import os from 'os';
import path from 'path';
import { config } from '../config/env';
import { StorageProvider } from '../services/storage/StorageProvider';
import { toStorageKey } from './storageKeys';

export function isDevelopmentStreaming(): boolean {
   return config.NODE_ENV === 'development' && config.STORAGE_PROVIDER === 'local';
}

/** FFmpeg output root for a chapter (dev: ./storage/bit_transcode/{id}, non-dev: OS temp). */
export function getTranscodeWorkspaceDir(chapterId: string): string {
   if (isDevelopmentStreaming()) {
      return path.join(process.cwd(), config.LOCAL_STORAGE_PATH, 'bit_transcode', chapterId);
   }
   return path.join(os.tmpdir(), 'srota-transcode', chapterId);
}

/** Relative output dir passed through transcoding jobs (bit_transcode/{chapterId}). */
export function getTranscodeOutputDir(chapterId: string): string {
   return `bit_transcode/${chapterId}`;
}

export function getBitrateWorkspaceDir(chapterId: string, bitrate: number): string {
   return path.join(getTranscodeWorkspaceDir(chapterId), `${bitrate}k`);
}

export function buildVariantStorageKey(chapterId: string, bitrate: number, fileName: string): string {
   return toStorageKey(`bit_transcode/${chapterId}/${bitrate}k/${fileName}`);
}

export function buildMasterStorageKey(chapterId: string): string {
   return toStorageKey(`bit_transcode/${chapterId}/master.m3u8`);
}

export async function getPresignedObjectUrl(
   storageKey: string,
   storageProvider: StorageProvider,
): Promise<string> {
   return storageProvider.getFileUrl(storageKey, config.HLS_PRESIGNED_URL_EXPIRES_IN);
}

export async function presignMasterPlaylistUrls(
   chapterId: string,
   bitrates: number[],
   storageProvider: StorageProvider,
   recommendedBitrate?: number,
   segmentFilesByBitrate?: Map<number, string[]>,
): Promise<string> {
   let masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:7\n\n';

   for (const bitrate of bitrates) {
      const bandwidth = bitrate * 1000;
      let playlistUrl: string;

      if (segmentFilesByBitrate?.has(bitrate)) {
         playlistUrl = await refreshAndPresignVariantPlaylistUrl(
            chapterId,
            bitrate,
            segmentFilesByBitrate.get(bitrate)!,
            storageProvider,
         );
      } else {
         const playlistKey = buildVariantStorageKey(chapterId, bitrate, 'playlist.m3u8');
         playlistUrl = await getPresignedObjectUrl(playlistKey, storageProvider);
      }

      masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},CODECS="mp4a.40.2"`;
      if (recommendedBitrate !== undefined && bitrate === recommendedBitrate) {
         masterPlaylist += ',RESOLUTION=0x0';
      }
      masterPlaylist += `\n${playlistUrl}\n\n`;
   }

   return masterPlaylist;
}

/** Upload a fresh variant playlist (presigned segment/init URLs) and return its presigned object URL. */
export async function refreshAndPresignVariantPlaylistUrl(
   chapterId: string,
   bitrate: number,
   segmentFileNames: string[],
   storageProvider: StorageProvider,
): Promise<string> {
   const variantContent = await presignVariantPlaylistUrls(
      chapterId,
      bitrate,
      segmentFileNames,
      storageProvider,
   );
   const playlistKey = buildVariantStorageKey(chapterId, bitrate, 'playlist.m3u8');
   await storageProvider.uploadFile(
      playlistKey,
      Buffer.from(variantContent, 'utf-8'),
      'application/vnd.apple.mpegurl',
   );
   return getPresignedObjectUrl(playlistKey, storageProvider);
}

export async function presignVariantPlaylistUrls(
   chapterId: string,
   bitrate: number,
   segmentFileNames: string[],
   storageProvider: StorageProvider,
): Promise<string> {
   const initKey = buildVariantStorageKey(chapterId, bitrate, 'init.mp4');
   const initUri = await getPresignedObjectUrl(initKey, storageProvider);

   let playlist = `#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:5\n#EXT-X-MAP:URI="${initUri}"\n\n`;

   for (const segmentName of segmentFileNames) {
      const segmentKey = buildVariantStorageKey(chapterId, bitrate, segmentName);
      const segmentUrl = await getPresignedObjectUrl(segmentKey, storageProvider);
      playlist += `#EXTINF:${config.HLS_SEGMENT_DURATION}.0,\n${segmentUrl}\n`;
   }

   playlist += '#EXT-X-ENDLIST\n';
   return playlist;
}

/** Cache-Control for API playlist responses in non-dev (presigned URLs must not be cached by clients). */
export function getPlaylistResponseCacheControl(): string {
   return isDevelopmentStreaming()
      ? 'public, max-age=60'
      : 'private, no-cache, no-store';
}

export function getMasterPlaylistResponseCacheControl(): string {
   return isDevelopmentStreaming()
      ? 'public, max-age=300'
      : 'private, no-cache, no-store';
}
