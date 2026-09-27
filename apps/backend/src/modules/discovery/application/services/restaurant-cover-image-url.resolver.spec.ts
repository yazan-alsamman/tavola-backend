import { RestaurantCoverImageUrlResolver } from './restaurant-cover-image-url.resolver';
import { FileRecord } from '@modules/files/domain/entities/file-record.entity';
import { InMemoryFileRepository } from '../../../../../test/restaurants/support/in-memory-file-repository';
import { FakeStoragePort } from '../../../../../test/restaurants/support/fake-storage-port';

const COVER_FILE_ID = 'aa6da0ad-e204-4fc8-b4a4-90dc957d729d';
const SECOND_COVER_FILE_ID = 'bb6da0ad-e204-4fc8-b4a4-90dc957d729d';
const MISSING_FILE_ID = 'cc6da0ad-e204-4fc8-b4a4-90dc957d729d';

function coverFile(id: string): FileRecord {
  return FileRecord.create({
    id,
    ownerId: '11111111-1111-4111-8111-111111111111',
    ownerType: 'Restaurant',
    bucket: 'tavla-public',
    objectKey: `restaurants/covers/${id}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 2048,
    accessPolicy: 'Public',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    deletedAt: null,
  });
}

function build() {
  const fileRepository = new InMemoryFileRepository();
  const storagePort = new FakeStoragePort();
  return {
    resolver: new RestaurantCoverImageUrlResolver(fileRepository, storagePort),
    fileRepository,
    storagePort,
  };
}

describe('RestaurantCoverImageUrlResolver', () => {
  it('signs a non-null coverImageUrl for a restaurant whose cover file exists', async () => {
    const { resolver, fileRepository } = build();
    fileRepository.seed(coverFile(COVER_FILE_ID));

    const [result] = await resolver.attach([{ restaurantId: 'r1', coverImageId: COVER_FILE_ID }]);

    expect(result.coverImageId).toBe(COVER_FILE_ID);
    expect(result.coverImageUrl).toBe(
      `https://signed.example.com/tavla-public/restaurants/covers/${COVER_FILE_ID}.jpg`,
    );
  });

  it('returns coverImageUrl: null when coverImageId is null, never a placeholder', async () => {
    const { resolver, storagePort } = build();
    const signSpy = jest.spyOn(storagePort, 'getSignedReadUrl');

    const [result] = await resolver.attach([{ restaurantId: 'r1', coverImageId: null }]);

    expect(result).toEqual({ restaurantId: 'r1', coverImageId: null, coverImageUrl: null });
    expect(signSpy).not.toHaveBeenCalled();
  });

  it('returns coverImageUrl: null (not "" and not an error) when the file row is missing', async () => {
    const { resolver, fileRepository } = build();
    fileRepository.seed(coverFile(COVER_FILE_ID));

    const results = await resolver.attach([
      { restaurantId: 'r1', coverImageId: MISSING_FILE_ID },
      { restaurantId: 'r2', coverImageId: COVER_FILE_ID },
    ]);

    expect(results[0].coverImageId).toBe(MISSING_FILE_ID);
    expect(results[0].coverImageUrl).toBeNull();
    expect(results[1].coverImageUrl).not.toBeNull();
  });

  it('resolves a whole page with one batched, de-duplicated file lookup (no N+1)', async () => {
    const { resolver, fileRepository } = build();
    fileRepository.seed(coverFile(COVER_FILE_ID));
    fileRepository.seed(coverFile(SECOND_COVER_FILE_ID));
    const findManySpy = jest.spyOn(fileRepository, 'findManyByIds');
    const findByIdSpy = jest.spyOn(fileRepository, 'findById');

    const results = await resolver.attach([
      { restaurantId: 'r1', coverImageId: COVER_FILE_ID },
      { restaurantId: 'r2', coverImageId: null },
      { restaurantId: 'r3', coverImageId: SECOND_COVER_FILE_ID },
      { restaurantId: 'r4', coverImageId: COVER_FILE_ID },
    ]);

    expect(findManySpy).toHaveBeenCalledTimes(1);
    expect(findManySpy.mock.calls[0][0].map((id) => id.value)).toEqual([
      COVER_FILE_ID,
      SECOND_COVER_FILE_ID,
    ]);
    expect(findByIdSpy).not.toHaveBeenCalled();
    expect(results.map((r) => r.restaurantId)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(results[0].coverImageUrl).toBe(results[3].coverImageUrl);
    expect(results[1].coverImageUrl).toBeNull();
  });

  it('skips the file lookup entirely when no restaurant on the page has a cover', async () => {
    const { resolver, fileRepository } = build();
    const findManySpy = jest.spyOn(fileRepository, 'findManyByIds');

    await resolver.attach([{ restaurantId: 'r1', coverImageId: null }]);

    expect(findManySpy).not.toHaveBeenCalled();
  });

  it('signs with the configured default TTL (no per-call expiry override)', async () => {
    const { resolver, fileRepository, storagePort } = build();
    fileRepository.seed(coverFile(COVER_FILE_ID));
    const signSpy = jest.spyOn(storagePort, 'getSignedReadUrl');

    await resolver.attach([{ restaurantId: 'r1', coverImageId: COVER_FILE_ID }]);

    expect(signSpy).toHaveBeenCalledWith('tavla-public', `restaurants/covers/${COVER_FILE_ID}.jpg`);
  });
});
