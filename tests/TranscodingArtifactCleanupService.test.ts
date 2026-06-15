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
const mockInitialize = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/services/storage/StorageFactory', () => ({
   StorageFactory: {
      initialize: mockInitialize,
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

   it('initializes storage and deletes all bit_transcode prefix candidates in non-dev', async () => {
      await TranscodingArtifactCleanupService.cleanupChapterArtifacts('chapter-123');

      expect(mockInitialize).toHaveBeenCalled();
      expect(StorageFactory.getStorageProvider).toHaveBeenCalled();
      expect(mockDeleteFilesByPrefix).toHaveBeenCalledWith('uploads/bit_transcode/chapter-123');
      expect(mockDeleteFilesByPrefix).toHaveBeenCalledWith('bit_transcode/chapter-123');
      expect(mockDeleteFilesByPrefix).toHaveBeenCalledWith('/uploads/bit_transcode/chapter-123');
   });
});
