jest.mock('../src/config/logger', () => ({
   logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
   },
}));

const mockRemoveJobsForChapter = jest.fn().mockResolvedValue(undefined);
const mockClearChapterCache = jest.fn().mockResolvedValue(2);
const mockCleanupChapterArtifacts = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/services/BullQueueManager', () => ({
   BullQueueManager: {
      getInstance: jest.fn(() => ({
         removeJobsForChapter: mockRemoveJobsForChapter,
      })),
   },
}));

jest.mock('../src/services/StreamingCacheService', () => ({
   StreamingCacheFactory: {
      getInstance: jest.fn(() => ({
         clearChapterCache: mockClearChapterCache,
      })),
   },
}));

jest.mock('../src/services/TranscodingArtifactCleanupService', () => ({
   TranscodingArtifactCleanupService: {
      cleanupChapterArtifacts: mockCleanupChapterArtifacts,
   },
}));

import { ChapterDeletionWorker } from '../src/workers/ChapterDeletionWorker';

describe('ChapterDeletionWorker', () => {
   beforeEach(() => {
      jest.clearAllMocks();
   });

   it('runs full cleanup even when no transcoded_chapters rows exist', async () => {
      const prisma = {
         transcodingJob: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
         },
         streamingSession: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
         },
         transcodedChapter: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
         },
      };

      const worker = new ChapterDeletionWorker(prisma as never);

      await (
         worker as unknown as {
            processChapterDeletion: (
               message: { chapterId: string; timestamp: string },
               raw: unknown
            ) => Promise<void>;
         }
      ).processChapterDeletion(
         { chapterId: 'chapter-123', timestamp: new Date().toISOString() },
         {}
      );

      expect(mockRemoveJobsForChapter).toHaveBeenCalledWith('chapter-123');
      expect(mockClearChapterCache).toHaveBeenCalledWith('chapter-123');
      expect(mockCleanupChapterArtifacts).toHaveBeenCalledWith('chapter-123');
      expect(prisma.transcodingJob.deleteMany).toHaveBeenCalledWith({ where: { chapterId: 'chapter-123' } });
      expect(prisma.streamingSession.deleteMany).toHaveBeenCalledWith({ where: { chapterId: 'chapter-123' } });
      expect(prisma.transcodedChapter.deleteMany).toHaveBeenCalledWith({ where: { chapterId: 'chapter-123' } });
   });
});
