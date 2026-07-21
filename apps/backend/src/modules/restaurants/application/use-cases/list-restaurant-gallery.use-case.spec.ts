import { ListRestaurantGalleryUseCase } from './list-restaurant-gallery.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { RestaurantGalleryImage } from '../../domain/entities/restaurant-gallery-image.entity';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { FileRecord } from '@modules/files/domain/entities/file-record.entity';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { InMemoryRestaurantGalleryRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-gallery.repository';
import { InMemoryFileRepository } from '../../../../../test/restaurants/support/in-memory-file-repository';
import { FakeStoragePort } from '../../../../../test/restaurants/support/fake-storage-port';

const BUCKET = 'tavla-public';

describe('ListRestaurantGalleryUseCase', () => {
  const fixedNow = new Date('2026-07-16T12:00:00.000Z');

  function baseActor() {
    return {
      actorType: AccessTokenActorType.OrganizationMember as const,
      userId: 'user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      organizationId: '33333333-3333-4333-8333-333333333333',
      orgRole: 'Owner',
      permissionsVersion: 1,
    };
  }

  async function seedRestaurant(
    restaurantRepository: InMemoryRestaurantRepository,
    restaurantSettingsRepository: InMemoryRestaurantSettingsRepository,
  ): Promise<string> {
    const createUseCase = new CreateRestaurantUseCase(
      restaurantRepository,
      restaurantSettingsRepository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      new CollectingEventPublisher(),
      new ImmediateUnitOfWork(),
    );
    const result = await createUseCase.execute({
      actor: baseActor(),
      name: 'The Old Mill',
      description: null,
      cuisineType: null,
      priceLevel: null,
    });
    return result.restaurantId;
  }

  it('returns an empty items array for a freshly created restaurant', async () => {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const galleryRepository = new InMemoryRestaurantGalleryRepository();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    const useCase = new ListRestaurantGalleryUseCase(
      restaurantRepository,
      galleryRepository,
      new InMemoryFileRepository(),
      new FakeStoragePort(),
    );

    const result = await useCase.execute({ actor: baseActor(), restaurantId });

    expect(result).toEqual({ restaurantId, items: [] });
  });

  it('returns items sorted by sortOrder, each with a freshly-signed imageUrl', async () => {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const galleryRepository = new InMemoryRestaurantGalleryRepository();
    const fileRepository = new InMemoryFileRepository();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    const fileA = FileRecord.create({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ownerId: restaurantId,
      ownerType: 'Restaurant',
      bucket: BUCKET,
      objectKey: `restaurants/${restaurantId}/gallery/a.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 500,
      accessPolicy: 'Public',
      createdAt: fixedNow,
      deletedAt: null,
    });
    const fileB = FileRecord.create({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ownerId: restaurantId,
      ownerType: 'Restaurant',
      bucket: BUCKET,
      objectKey: `restaurants/${restaurantId}/gallery/b.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 500,
      accessPolicy: 'Public',
      createdAt: fixedNow,
      deletedAt: null,
    });
    fileRepository.seed(fileA);
    fileRepository.seed(fileB);

    await galleryRepository.add(
      RestaurantGalleryImage.create({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        restaurantId,
        fileId: fileB.fileId.value,
        caption: 'Second',
        sortOrder: 1,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
    );
    await galleryRepository.add(
      RestaurantGalleryImage.create({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        restaurantId,
        fileId: fileA.fileId.value,
        caption: 'First',
        sortOrder: 0,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
    );

    const useCase = new ListRestaurantGalleryUseCase(
      restaurantRepository,
      galleryRepository,
      fileRepository,
      new FakeStoragePort(),
    );

    const result = await useCase.execute({ actor: baseActor(), restaurantId });

    expect(result.items.map((item) => item.caption)).toEqual(['First', 'Second']);
    expect(result.items[0].imageUrl).toContain(fileA.objectKey);
    expect(result.items[1].imageUrl).toContain(fileB.objectKey);
  });

  it('returns null imageUrl when the underlying File record is missing', async () => {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const galleryRepository = new InMemoryRestaurantGalleryRepository();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    await galleryRepository.add(
      RestaurantGalleryImage.create({
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        restaurantId,
        fileId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        caption: null,
        sortOrder: 0,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
    );

    const useCase = new ListRestaurantGalleryUseCase(
      restaurantRepository,
      galleryRepository,
      new InMemoryFileRepository(),
      new FakeStoragePort(),
    );

    const result = await useCase.execute({ actor: baseActor(), restaurantId });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].imageUrl).toBeNull();
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const useCase = new ListRestaurantGalleryUseCase(
      new InMemoryRestaurantRepository(),
      new InMemoryRestaurantGalleryRepository(),
      new InMemoryFileRepository(),
      new FakeStoragePort(),
    );

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
