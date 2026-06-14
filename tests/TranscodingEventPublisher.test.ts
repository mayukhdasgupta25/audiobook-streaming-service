const mockPublish = jest.fn().mockResolvedValue(1);

jest.mock('../src/config/redis', () => ({
   RedisConnection: {
      getInstance: () => ({
         getClient: () => ({
            publish: mockPublish,
            duplicate: jest.fn(),
         }),
      }),
   },
}));

jest.mock('../src/config/logger', () => ({
   redisLogger: { error: jest.fn() },
}));

import { TranscodingEventPublisher } from '../src/services/TranscodingEventPublisher';

describe('TranscodingEventPublisher', () => {
   it('buildEvent includes required progress field', () => {
      const publisher = TranscodingEventPublisher.getInstance();
      const event = publisher.buildEvent('chapter-1', 128, 'processing', 47);

      expect(event).toEqual(
         expect.objectContaining({
            chapterId: 'chapter-1',
            bitrate: 128,
            status: 'processing',
            progress: 47,
         })
      );
      expect(event.timestamp).toBeDefined();
   });

   it('throttles progress events within 500ms and 2% delta', async () => {
      const publisher = TranscodingEventPublisher.getInstance();
      publisher.clearThrottle('chapter-2', 64);
      mockPublish.mockClear();

      await publisher.publishProgress('chapter-2', 64, 10, { force: true });
      await publisher.publishProgress('chapter-2', 64, 11);
      await publisher.publishProgress('chapter-2', 64, 15, { force: true });

      expect(mockPublish).toHaveBeenCalledTimes(2);
   });
});
