import { BitrateTranscodingRepository } from '../src/services/BitrateTranscodingRepository';

describe('BitrateTranscodingRepository', () => {
   it('commitCompletedLocal runs DB upsert before returning storage paths', async () => {
      const upsert = jest.fn().mockResolvedValue({});
      const transaction = jest.fn(async (callback: (tx: unknown) => Promise<void>) => {
         await callback({ transcodedChapter: { upsert } });
      });

      const prisma = {
         $transaction: transaction,
         transcodedChapter: { upsert },
      } as unknown as ConstructorParameters<typeof BitrateTranscodingRepository>[0];

      const repo = new BitrateTranscodingRepository(prisma);
      const s3Upload = jest.fn();

      const result = await repo.commitCompletedLocal('chapter-1', 128);
      await s3Upload();

      expect(transaction).toHaveBeenCalledBefore(s3Upload);
      expect(result.playlistUrl).toContain('chapter-1');
      expect(result.playlistUrl).toContain('128k');
   });
});
