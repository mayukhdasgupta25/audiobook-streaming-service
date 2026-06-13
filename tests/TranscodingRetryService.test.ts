import { TranscodingRetryService } from '../src/services/TranscodingRetryService';

jest.mock('../src/config/env', () => ({
   config: { TRANSCODING_BITRATES: [64, 128], HLS_SEGMENT_DURATION: 6 },
}));

const mockResetForRetry = jest.fn().mockResolvedValue(undefined);
const mockPublishStatusTransition = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/services/BitrateTranscodingRepository', () => ({
   BitrateTranscodingRepository: jest.fn().mockImplementation(() => ({
      resetForRetry: mockResetForRetry,
   })),
}));

jest.mock('../src/services/TranscodingEventPublisher', () => ({
   TranscodingEventPublisher: {
      getInstance: () => ({
         publishStatusTransition: mockPublishStatusTransition,
      }),
   },
}));

jest.mock('../src/services/DetailedTranscodingService', () => ({
   DetailedTranscodingService: jest.fn().mockImplementation(() => ({
      getFailedBitrates: jest.fn().mockResolvedValue([64]),
   })),
}));

describe('TranscodingRetryService', () => {
   beforeEach(() => {
      jest.clearAllMocks();
   });

   it('resets failed bitrates to pending and enqueues bitrate + master jobs', async () => {
      const addBitrateTranscodingJob = jest.fn().mockResolvedValue({ id: 'job-1' });
      const addMasterPlaylistJob = jest.fn().mockResolvedValue({ id: 'master-1' });

      const prisma = {
         transcodedChapter: {
            findMany: jest.fn().mockResolvedValue([
               { chapterId: 'ch-1', bitrate: 64, status: 'failed', progress: 30 },
            ]),
         },
      } as unknown as ConstructorParameters<typeof TranscodingRetryService>[0];

      const bullQueueManager = {
         addBitrateTranscodingJob,
         addMasterPlaylistJob,
      } as unknown as ConstructorParameters<typeof TranscodingRetryService>[1];

      const service = new TranscodingRetryService(prisma, bullQueueManager);
      const result = await service.retryFailedBitrates({
         chapterId: 'ch-1',
         inputPath: 'uploads/chapters/audio.mp3',
      });

      expect(result.retriedBitrates).toEqual([64]);
      expect(mockResetForRetry).toHaveBeenCalledWith('ch-1', [64]);
      expect(addBitrateTranscodingJob).toHaveBeenCalledTimes(1);
      expect(addMasterPlaylistJob).toHaveBeenCalledWith(
         expect.objectContaining({ chapterId: 'ch-1', variantBitrates: [64] }),
         'normal'
      );
   });
});
