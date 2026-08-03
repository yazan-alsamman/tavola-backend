import { RemoveRestaurantGalleryImageUseCase } from './remove-restaurant-gallery-image.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { RestaurantGalleryItemNotFoundException } from '../../domain/exceptions/restaurant-gallery-item-not-found.exception';
import { RestaurantGalleryImage } from '../../domain/entities/restaurant-gallery-image.entity';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { FileRecord } from '@modules/files/domain/entities/file-record.entity';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingAuditLogWriter,
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { createPermissiveSubscriptionFixture } from '../../../../../test/subscriptions/support/permissive-subscription-fixture';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { InMemoryRestaurantGalleryRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-gallery.repository';
import { InMemoryFileRepository } from '../../../../../test/restaurants/support/in-memory-file-repository';
import { FakeStoragePort } from '../../../../../test/restaurants/support/fake-storage-port';

const BUCKET = 'tavla-public';

describe('RemoveRestaurantGalleryImageUseCase', () => {
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
    name = 'The Old Mill',
  ): Promise<string> {
    const {
      subscriptionRepository,
      subscriptionPlanRepository,
      subscriptionUsageRepository,
      restaurantUsageRepository,
    } = createPermissiveSubscriptionFixture(
      '33333333-3333-4333-8333-333333333333',
      {
        planId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        subscriptionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        usageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
      fixedNow,
    );
    const createUseCase = new CreateRestaurantUseCase(
      restaurantRepository,
      restaurantSettingsRepository,
      restaurantUsageRepository,
      subscriptionRepository,
      subscriptionPlanRepository,
      subscriptionUsageRepository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      new CollectingEventPublisher(),
      new ImmediateUnitOfWork(),
    );
    const result = await createUseCase.execute({
      actor: baseActor(),
      name,
      description: null,
      cuisineType: null,
      priceLevel: null,
    });
    return result.restaurantId;
  }

  async function seedGalleryImage(
    galleryRepository: InMemoryRestaurantGalleryRepository,
    fileRepository: InMemoryFileRepository,
    restaurantId: string,
  ): Promise<{ galleryItemId: string; fileId: string; objectKey: string }> {
    const fileId = '11111111-1111-4111-8111-111111111111';
    const objectKey = `restaurants/${restaurantId}/gallery/${fileId}.jpg`;
    fileRepository.seed(
      FileRecord.create({
        id: fileId,
        ownerId: restaurantId,
        ownerType: 'Restaurant',
        bucket: BUCKET,
        objectKey,
        mimeType: 'image/jpeg',
        sizeBytes: 500,
        accessPolicy: 'Public',
        createdAt: fixedNow,
        deletedAt: null,
      }),
    );
    const galleryItemId = '22222222-2222-4222-8222-222222222222';
    await galleryRepository.add(
      RestaurantGalleryImage.create({
        id: galleryItemId,
        restaurantId,
        fileId,
        caption: null,
        sortOrder: 0,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
    );
    return { galleryItemId, fileId, objectKey };
  }

  function createUseCase(overrides?: { auditLogWriter?: CollectingAuditLogWriter }) {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const galleryRepository = new InMemoryRestaurantGalleryRepository();
    const fileRepository = new InMemoryFileRepository();
    const storagePort = new FakeStoragePort();
    const auditLogWriter = overrides?.auditLogWriter ?? new CollectingAuditLogWriter();
    const useCase = new RemoveRestaurantGalleryImageUseCase(
      restaurantRepository,
      galleryRepository,
      fileRepository,
      storagePort,
      new FixedClock(fixedNow),
      auditLogWriter,
      new ImmediateUnitOfWork(),
    );
    return {
      useCase,
      restaurantRepository,
      restaurantSettingsRepository,
      galleryRepository,
      fileRepository,
      storagePort,
      auditLogWriter,
    };
  }

  it('removes the gallery row, soft-deletes the File, and deletes the storage object', async () => {
    const {
      useCase,
      restaurantRepository,
      restaurantSettingsRepository,
      galleryRepository,
      fileRepository,
      storagePort,
    } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    const { galleryItemId, fileId, objectKey } = await seedGalleryImage(
      galleryRepository,
      fileRepository,
      restaurantId,
    );

    await useCase.execute({ actor: baseActor(), restaurantId, galleryItemId });

    expect(
      await galleryRepository.findById(galleryItemId, RestaurantId.create(restaurantId)),
    ).toBeNull();
    expect(fileRepository.get(fileId)?.isDeleted()).toBe(true);
    expect(storagePort.deleted).toContainEqual({ bucket: BUCKET, objectKey });
  });

  it('writes exactly one audit log entry describing the removal', async () => {
    const auditLogWriter = new CollectingAuditLogWriter();
    const {
      useCase,
      restaurantRepository,
      restaurantSettingsRepository,
      galleryRepository,
      fileRepository,
    } = createUseCase({ auditLogWriter });
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    const { galleryItemId } = await seedGalleryImage(
      galleryRepository,
      fileRepository,
      restaurantId,
    );

    await useCase.execute({
      actor: baseActor(),
      restaurantId,
      galleryItemId,
      correlationId: 'corr-1',
    });

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: 'user-1',
      actorType: 'User',
      action: 'restaurant.gallery.image_removed',
      targetType: 'Restaurant',
      targetId: restaurantId,
      organizationId: baseActor().organizationId,
      correlationId: 'corr-1',
    });
  });

  it('throws RestaurantGalleryItemNotFoundException for a nonexistent gallery item', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        galleryItemId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      }),
    ).rejects.toBeInstanceOf(RestaurantGalleryItemNotFoundException);
  });

  it('throws RestaurantGalleryItemNotFoundException (IDOR) when the gallery item belongs to a different restaurant', async () => {
    const {
      useCase,
      restaurantRepository,
      restaurantSettingsRepository,
      galleryRepository,
      fileRepository,
    } = createUseCase();
    const restaurantIdA = await seedRestaurant(
      restaurantRepository,
      restaurantSettingsRepository,
      'The Old Mill',
    );
    const restaurantIdB = await seedRestaurant(
      restaurantRepository,
      restaurantSettingsRepository,
      'The New Mill',
    );
    const { galleryItemId } = await seedGalleryImage(
      galleryRepository,
      fileRepository,
      restaurantIdA,
    );

    await expect(
      useCase.execute({ actor: baseActor(), restaurantId: restaurantIdB, galleryItemId }),
    ).rejects.toBeInstanceOf(RestaurantGalleryItemNotFoundException);

    // the item under restaurant A is untouched
    expect(
      await galleryRepository.findById(galleryItemId, RestaurantId.create(restaurantIdA)),
    ).not.toBeNull();
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const { useCase } = createUseCase();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        galleryItemId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('does not fail the request when storage delete fails, and still cleans up the DB rows', async () => {
    const {
      useCase,
      restaurantRepository,
      restaurantSettingsRepository,
      galleryRepository,
      fileRepository,
      storagePort,
    } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    const { galleryItemId, fileId } = await seedGalleryImage(
      galleryRepository,
      fileRepository,
      restaurantId,
    );
    storagePort.deleteShouldFail = true;

    await useCase.execute({ actor: baseActor(), restaurantId, galleryItemId });

    expect(
      await galleryRepository.findById(galleryItemId, RestaurantId.create(restaurantId)),
    ).toBeNull();
    expect(fileRepository.get(fileId)?.isDeleted()).toBe(true);
  });
});
