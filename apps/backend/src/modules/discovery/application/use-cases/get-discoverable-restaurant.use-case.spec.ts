import { GetDiscoverableRestaurantUseCase } from './get-discoverable-restaurant.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { ListRestaurantWorkingHoursFromBranchesUseCase } from '@modules/branches/application/use-cases/list-restaurant-working-hours-from-branches.use-case';
import { BranchWorkingHours } from '@modules/branches/domain/entities/branch-working-hours.entity';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import { FakeDiscoveryReader } from '../../../../../test/discovery/support/fake-discovery-reader';
import { InMemoryBranchWorkingHoursRepository } from '../../../../../test/branches/support/in-memory-branch-working-hours.repository';
import { RestaurantResult } from '@modules/restaurants/application/dto/restaurant.result';
import { FileRecord } from '@modules/files/domain/entities/file-record.entity';
import { RestaurantCoverImageUrlResolver } from '../services/restaurant-cover-image-url.resolver';
import { InMemoryFileRepository } from '../../../../../test/restaurants/support/in-memory-file-repository';
import { FakeStoragePort } from '../../../../../test/restaurants/support/fake-storage-port';

const firstBranchId = '44444444-4444-4444-8444-444444444441';

const restaurantId = '11111111-1111-4111-8111-111111111111';

function restaurant(): RestaurantResult {
  return {
    restaurantId,
    name: 'The Old Mill',
    slug: 'the-old-mill',
    logoId: null,
    coverImageId: null,
    description: 'Cozy spot.',
    cuisineType: 'Italian',
    averageRating: 4.5,
    ratingCount: 0,
    priceLevel: 2,
    status: 'Active',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

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

function buildUseCase(reader: FakeDiscoveryReader) {
  const workingHoursRepository = new InMemoryBranchWorkingHoursRepository();
  const listWorkingHoursByRestaurantIdsUseCase = new ListRestaurantWorkingHoursFromBranchesUseCase(
    workingHoursRepository,
  );
  const fileRepository = new InMemoryFileRepository();
  return {
    useCase: new GetDiscoverableRestaurantUseCase(
      reader,
      listWorkingHoursByRestaurantIdsUseCase,
      new RestaurantCoverImageUrlResolver(fileRepository, new FakeStoragePort()),
    ),
    workingHoursRepository,
    fileRepository,
  };
}

describe('GetDiscoverableRestaurantUseCase', () => {
  it('returns a discoverable restaurant by id, from any organization', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant()];

    const { useCase } = buildUseCase(reader);
    const result = await useCase.execute({ restaurantId });
    expect(result.name).toBe('The Old Mill');
  });

  it('404s for an unknown restaurant id', async () => {
    const reader = new FakeDiscoveryReader();
    const { useCase } = buildUseCase(reader);
    await expect(useCase.execute({ restaurantId })).rejects.toBeInstanceOf(
      RestaurantNotFoundException,
    );
  });

  it('includes workingHours from the oldest branch schedule (ADR-050)', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant()];

    const { useCase, workingHoursRepository } = buildUseCase(reader);
    workingHoursRepository.registerBranch(restaurantId, firstBranchId);
    await workingHoursRepository.replaceAllForBranch(BranchId.create(firstBranchId), [
      BranchWorkingHours.create({
        id: '33333333-3333-4333-8333-333333333331',
        branchId: firstBranchId,
        dayOfWeek: 2,
        openingTime: '09:00',
        closingTime: '17:00',
        breakStartTime: '12:00',
        breakEndTime: '13:00',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ]);

    const result = await useCase.execute({ restaurantId });
    expect(result.workingHours).toEqual([
      {
        dayOfWeek: 2,
        openingTime: '09:00',
        closingTime: '17:00',
        breakStartTime: '12:00',
        breakEndTime: '13:00',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ]);
  });

  it('defaults workingHours to an empty array when none is configured', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant()];

    const { useCase } = buildUseCase(reader);
    const result = await useCase.execute({ restaurantId });
    expect(result.workingHours).toEqual([]);
  });

  it('includes a signed coverImageUrl when the restaurant has a cover file', async () => {
    const coverId = 'aa6da0ad-e204-4fc8-b4a4-90dc957d729d';
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [{ ...restaurant(), coverImageId: coverId }];

    const { useCase, fileRepository } = buildUseCase(reader);
    fileRepository.seed(coverFile(coverId));
    const result = await useCase.execute({ restaurantId });

    expect(result.coverImageId).toBe(coverId);
    expect(result.coverImageUrl).toBe(
      `https://signed.example.com/tavla-public/restaurants/covers/${coverId}.jpg`,
    );
  });

  it('returns coverImageUrl: null when coverImageId is null', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [restaurant()];

    const { useCase } = buildUseCase(reader);
    const result = await useCase.execute({ restaurantId });

    expect(result.coverImageId).toBeNull();
    expect(result.coverImageUrl).toBeNull();
  });

  it('returns coverImageUrl: null (not a 500) when the cover file row is missing', async () => {
    const reader = new FakeDiscoveryReader();
    reader.restaurants = [
      { ...restaurant(), coverImageId: 'cc6da0ad-e204-4fc8-b4a4-90dc957d729d' },
    ];

    const { useCase } = buildUseCase(reader);
    const result = await useCase.execute({ restaurantId });

    expect(result.coverImageUrl).toBeNull();
  });
});
