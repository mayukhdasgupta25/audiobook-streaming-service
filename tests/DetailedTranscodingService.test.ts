import { DetailedTranscodingService } from '../src/services/DetailedTranscodingService';

jest.mock('../src/config/env', () => ({
   config: { TRANSCODING_BITRATES: [64, 128, 256] },
}));

jest.mock('../src/services/storage/StorageFactory', () => ({
   StorageFactory: {
      initialize: jest.fn(),
      getStorageProvider: jest.fn(() => ({ fileExists: jest.fn().mockResolvedValue(true) })),
   },
}));

describe('DetailedTranscodingService', () => {
   it('getDetailedStatus includes live progress per expected bitrate', async () => {
      const prisma = {
         transcodedChapter: {
            findMany: jest.fn().mockResolvedValue([
               { chapterId: 'ch-1', bitrate: 64, status: 'completed', progress: 100, errorMessage: null },
               { chapterId: 'ch-1', bitrate: 128, status: 'processing', progress: 47, errorMessage: null },
            ]),
         },
      } as unknown as ConstructorParameters<typeof DetailedTranscodingService>[0];

      const service = new DetailedTranscodingService(prisma);
      const status = await service.getDetailedStatus('ch-1');

      expect(status.bitrates).toHaveLength(3);
      expect(status.bitrates.find(b => b.bitrate === 128)).toEqual(
         expect.objectContaining({ status: 'processing', progress: 47 })
      );
      expect(status.bitrates.find(b => b.bitrate === 256)).toEqual(
         expect.objectContaining({ status: 'pending', progress: 0 })
      );
      expect(status.aggregateStatus).toBe('partial');
   });
});
