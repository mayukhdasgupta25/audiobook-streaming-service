/**
 * streamingStorage utility tests
 */
import path from 'path';
import os from 'os';
import { StorageProvider } from '../src/services/storage/StorageProvider';

const mockConfig = {
   NODE_ENV: 'staging',
   STORAGE_PROVIDER: 's3',
   LOCAL_STORAGE_PATH: './storage',
   HLS_SEGMENT_DURATION: 4,
   HLS_PRESIGNED_URL_EXPIRES_IN: 7200,
};

jest.mock('../src/config/env', () => ({
   config: mockConfig,
}));

jest.mock('../src/utils/storageKeys', () => ({
   toStorageKey: (relativePath: string) => `uploads/${relativePath.replace(/^\/+/, '')}`,
}));

import {
   isDevelopmentStreaming,
   getTranscodeWorkspaceDir,
   buildVariantStorageKey,
   presignMasterPlaylistUrls,
   presignVariantPlaylistUrls,
   getPresignedObjectUrl,
} from '../src/utils/streamingStorage';

describe('streamingStorage (non-dev)', () => {
   const mockStorage: Pick<StorageProvider, 'getFileUrl' | 'uploadFile'> = {
      getFileUrl: jest.fn(async (key: string) =>
         `https://bucket.s3.amazonaws.com/${key}?X-Amz-Signature=abc123`),
      uploadFile: jest.fn(async () => 'uploads/bit_transcode/ch1/128k/playlist.m3u8'),
   };

   beforeEach(() => {
      jest.clearAllMocks();
      mockConfig.NODE_ENV = 'staging';
      mockConfig.STORAGE_PROVIDER = 's3';
   });

   it('isDevelopmentStreaming is false for s3 staging', () => {
      expect(isDevelopmentStreaming()).toBe(false);
   });

   it('getTranscodeWorkspaceDir uses OS temp in non-dev', () => {
      const dir = getTranscodeWorkspaceDir('chapter-1');
      expect(dir).toBe(path.join(os.tmpdir(), 'srota-transcode', 'chapter-1'));
      expect(dir).not.toContain('storage');
   });

   it('buildVariantStorageKey prefixes uploads in non-dev', () => {
      expect(buildVariantStorageKey('ch1', 128, 'init.mp4')).toBe(
         'uploads/bit_transcode/ch1/128k/init.mp4',
      );
   });

   it('getPresignedObjectUrl uses HLS presign expiry', async () => {
      await getPresignedObjectUrl('uploads/bit_transcode/ch1/128k/init.mp4', mockStorage as StorageProvider);
      expect(mockStorage.getFileUrl).toHaveBeenCalledWith(
         'uploads/bit_transcode/ch1/128k/init.mp4',
         7200,
      );
   });

   it('presignMasterPlaylistUrls refreshes variant playlists when segment map provided', async () => {
      const segmentMap = new Map<number, string[]>([
         [128, ['segment_001.m4s']],
         [256, ['segment_001.m4s']],
      ]);

      const master = await presignMasterPlaylistUrls(
         'ch1',
         [128, 256],
         mockStorage as StorageProvider,
         undefined,
         segmentMap,
      );

      expect(mockStorage.uploadFile).toHaveBeenCalledTimes(2);
      expect(master).toContain('X-Amz-Signature=abc123');
      expect(master).not.toContain('localhost');
   });

   it('presignVariantPlaylistUrls embeds presigned init and segment URLs', async () => {
      const variant = await presignVariantPlaylistUrls(
         'ch1',
         128,
         ['segment_001.m4s', 'segment_002.m4s'],
         mockStorage as StorageProvider,
      );

      expect(variant).toContain('https://bucket.s3.amazonaws.com/uploads/bit_transcode/ch1/128k/init.mp4?X-Amz-Signature=abc123');
      expect(variant).toContain('https://bucket.s3.amazonaws.com/uploads/bit_transcode/ch1/128k/segment_001.m4s?X-Amz-Signature=abc123');
      expect(variant).toContain('https://bucket.s3.amazonaws.com/uploads/bit_transcode/ch1/128k/segment_002.m4s?X-Amz-Signature=abc123');
      expect(variant).not.toContain('localhost');
   });
});

describe('streamingStorage (development)', () => {
   beforeEach(() => {
      mockConfig.NODE_ENV = 'development';
      mockConfig.STORAGE_PROVIDER = 'local';
   });

   it('isDevelopmentStreaming is true for local development', () => {
      expect(isDevelopmentStreaming()).toBe(true);
   });

   it('getTranscodeWorkspaceDir uses ./storage/bit_transcode in development', () => {
      const dir = getTranscodeWorkspaceDir('chapter-1');
      expect(dir).toContain(path.join('storage', 'bit_transcode', 'chapter-1'));
   });
});
