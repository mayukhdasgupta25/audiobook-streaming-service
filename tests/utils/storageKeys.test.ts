import {
   resolveStorageCandidateKeys,
   resolveExistingStorageKey,
} from '../../src/utils/storageKeys';
import { StorageProvider } from '../../src/services/storage/StorageProvider';

jest.mock('../../src/config/env', () => ({
   config: {
      NODE_ENV: 'testing',
   },
}));

describe('storageKeys', () => {
   describe('resolveStorageCandidateKeys', () => {
      it('includes canonical and legacy leading-slash keys for chapter audio paths', () => {
         const candidates = resolveStorageCandidateKeys('/uploads/chapters/audio-1.mp3');

         expect(candidates).toEqual(
            expect.arrayContaining([
               'uploads/chapters/audio-1.mp3',
               '/uploads/chapters/audio-1.mp3',
               'chapters/audio-1.mp3',
            ]),
         );
      });
   });

   describe('resolveExistingStorageKey', () => {
      it('returns the first candidate key that exists in storage', async () => {
         const storageProvider = {
            fileExists: jest.fn(async (key: string) => key === '/uploads/chapters/audio-1.mp3'),
         } as unknown as StorageProvider;

         const resolved = await resolveExistingStorageKey(
            '/uploads/chapters/audio-1.mp3',
            storageProvider,
         );

         expect(resolved).toBe('/uploads/chapters/audio-1.mp3');
         expect(storageProvider.fileExists).toHaveBeenCalled();
      });

      it('returns null when no candidate key exists', async () => {
         const storageProvider = {
            fileExists: jest.fn(async () => false),
         } as unknown as StorageProvider;

         const resolved = await resolveExistingStorageKey(
            '/uploads/chapters/missing.mp3',
            storageProvider,
         );

         expect(resolved).toBeNull();
      });
   });
});
