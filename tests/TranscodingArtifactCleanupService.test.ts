jest.mock('../src/config/env', () => ({
   config: {
      NODE_ENV: 'staging',
      STORAGE_PROVIDER: 's3',
      LOCAL_STORAGE_PATH: './storage',
   },
}));

jest.mock('../src/config/logger', () => ({
   logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
   },
}));

const mockDeleteFilesByPrefix = jest.fn().mockResolvedValue(5);

jest.mock('../src/services/storage/StorageFactory', () => ({
   StorageFactory: {
      getStorageProvider: jest.fn(() => ({
         deleteFilesByPrefix: mockDeleteFilesByPrefix,
      })),
   },
}));

import { TranscodingArtifactCleanupService } from '../src/services/TranscodingArtifactCleanupService';
import { StorageFactory } from '../src/services/storage/StorageFactory';

describe('TranscodingArtifactCleanupService', () => {
   beforeEach(() => {
      jest.clearAllMocks();
   });

   it('deletes S3 objects under uploads/bit_transcode/{chapterId}/ in non-dev', async () => {
      await TranscodingArtifactCleanupService.cleanupChapterArtifacts('chapter-123');

      expect(StorageFactory.getStorageProvider).toHaveBeenCalled();
      expect(mockDeleteFilesByPrefix).toHaveBeenCalledWith('uploads/bit_transcode/chapter-123');
   });
});
