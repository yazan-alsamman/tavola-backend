import { UploadRestaurantImageUseCase } from './upload-restaurant-image.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { MissingRestaurantImageFileException } from '../../domain/exceptions/missing-restaurant-image-file.exception';
import { InvalidRestaurantImageFileException } from '../../domain/exceptions/invalid-restaurant-image-file.exception';
import { RestaurantImageStorageUnavailableException } from '../../domain/exceptions/restaurant-image-storage-unavailable.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingAuditLogWriter,
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { createPermissiveSubscriptionFixture } from '../../../../../test/subscriptions/support/permissive-subscription-fixture';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { InMemoryFileRepository } from '../../../../../test/restaurants/support/in-memory-file-repository';
import { FakeStoragePort } from '../../../../../test/restaurants/support/fake-storage-port';

const BUCKET = 'tavla-public';
const FILE_ID = '66666666-6666-4666-8666-666666666666';
const REPLACEMENT_FILE_ID = '77777777-7777-4777-8777-777777777777';

describe('UploadRestaurantImageUseCase', () => {
  const fixedNow = new Date('2026-07-16T12:00:00.000Z');
  const validJpegBuffer = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(32, 0),
  ]);

  function baseActor() {
    return {
      actorType: AccessTokenActorType.OrganizationMember as const,
      userId: 'user-1',
      organizationId: '33333333-3333-4333-8333-333333333333',
    };
  }

  function jpeg() {
    return { buffer: validJpegBuffer, mimeType: 'image/jpeg', sizeBytes: validJpegBuffer.length };
  }

  async function seedRestaurant(
    restaurantRepository: InMemoryRestaurantRepository,
    restaurantSettingsRepository: InMemoryRestaurantSettingsRepository,
  ): Promise<string> {
    const {
      subscriptionRepository,
      subscriptionPlanRepository,
      subscriptionUsageRepository,
      restaurantUsageRepository,
    } = createPermissiveSubscriptionFixture(baseActor().organizationId, {
      planId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      subscriptionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      usageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    }, fixedNow);
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
      organizationId: baseActor().organizationId,
      actorId: baseActor().userId,
      name: 'The Old Mill',
      description: null,
      cuisineType: null,
      priceLevel: null,
    });
    return result.restaurantId;
  }

  function createUseCase(ids: string[] = [FILE_ID]) {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const fileRepository = new InMemoryFileRepository();
    const storagePort = new FakeStoragePort();
    const auditLogWriter = new CollectingAuditLogWriter();
    const useCase = new UploadRestaurantImageUseCase(
      restaurantRepository,
      fileRepository,
      storagePort,
      new FixedClock(fixedNow),
      new SequentialIdGenerator(ids),
      auditLogWriter,
      BUCKET,
    );
    return { useCase, restaurantRepository, restaurantSettingsRepository, fileRepository, storagePort, auditLogWriter };
  }

  it('stores the object and sets coverImageId, leaving the gallery unused', async () => {
    const ctx = createUseCase();
    const restaurantId = await seedRestaurant(ctx.restaurantRepository, ctx.restaurantSettingsRepository);

    const result = await ctx.useCase.execute({
      actorUserId: baseActor().userId,
      organizationId: baseActor().organizationId,
      restaurantId,
      slot: 'cover',
      file: jpeg(),
    });

    expect(result.fileId).toBe(FILE_ID);
    expect(result.imageUrl).toContain(`${BUCKET}/restaurants/${restaurantId}/cover/${FILE_ID}.jpg`);
    const saved = await ctx.restaurantRepository.findById(RestaurantId.create(restaurantId));
    expect(saved?.coverImageId).toBe(FILE_ID);
    expect(saved?.logoId).toBeNull();
    expect(ctx.storagePort.uploaded).toHaveLength(1);
    expect(ctx.storagePort.uploaded[0].objectKey).toBe(
      `restaurants/${restaurantId}/cover/${FILE_ID}.jpg`,
    );
    expect(ctx.auditLogWriter.entries[0]?.action).toBe('restaurant.cover.uploaded');
  });

  it('replaces a previous cover and removes the old object', async () => {
    const ctx = createUseCase([FILE_ID, REPLACEMENT_FILE_ID]);
    const restaurantId = await seedRestaurant(ctx.restaurantRepository, ctx.restaurantSettingsRepository);
    await ctx.useCase.execute({
      actorUserId: baseActor().userId,
      organizationId: baseActor().organizationId,
      restaurantId,
      slot: 'cover',
      file: jpeg(),
    });

    const replaced = await ctx.useCase.execute({
      actorUserId: baseActor().userId,
      organizationId: baseActor().organizationId,
      restaurantId,
      slot: 'cover',
      file: jpeg(),
    });

    expect(replaced.fileId).toBe(REPLACEMENT_FILE_ID);
    const saved = await ctx.restaurantRepository.findById(RestaurantId.create(restaurantId));
    expect(saved?.coverImageId).toBe(REPLACEMENT_FILE_ID);
    expect(ctx.storagePort.deleted.map((item) => item.objectKey)).toContain(
      `restaurants/${restaurantId}/cover/${FILE_ID}.jpg`,
    );
    const previous = ctx.fileRepository.get(FILE_ID);
    expect(previous?.isDeleted()).toBe(true);
  });

  it('sets logoId without changing coverImageId', async () => {
    const ctx = createUseCase();
    const restaurantId = await seedRestaurant(ctx.restaurantRepository, ctx.restaurantSettingsRepository);

    await ctx.useCase.execute({
      actorUserId: baseActor().userId,
      organizationId: baseActor().organizationId,
      restaurantId,
      slot: 'logo',
      file: jpeg(),
    });

    const saved = await ctx.restaurantRepository.findById(RestaurantId.create(restaurantId));
    expect(saved?.logoId).toBe(FILE_ID);
    expect(saved?.coverImageId).toBeNull();
    expect(ctx.auditLogWriter.entries[0]?.action).toBe('restaurant.logo.uploaded');
  });

  it('throws when the restaurant does not exist and uploads nothing', async () => {
    const ctx = createUseCase();
    await expect(
      ctx.useCase.execute({
        actorUserId: baseActor().userId,
        organizationId: baseActor().organizationId,
        restaurantId: '99999999-9999-4999-8999-999999999999',
        slot: 'cover',
        file: jpeg(),
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
    expect(ctx.storagePort.uploaded).toHaveLength(0);
  });

  it('rejects a missing file', async () => {
    const ctx = createUseCase();
    const restaurantId = await seedRestaurant(ctx.restaurantRepository, ctx.restaurantSettingsRepository);
    await expect(
      ctx.useCase.execute({
        actorUserId: baseActor().userId,
        organizationId: baseActor().organizationId,
        restaurantId,
        slot: 'cover',
        file: null,
      }),
    ).rejects.toBeInstanceOf(MissingRestaurantImageFileException);
  });

  it('rejects a file whose bytes do not match the declared type', async () => {
    const ctx = createUseCase();
    const restaurantId = await seedRestaurant(ctx.restaurantRepository, ctx.restaurantSettingsRepository);
    await expect(
      ctx.useCase.execute({
        actorUserId: baseActor().userId,
        organizationId: baseActor().organizationId,
        restaurantId,
        slot: 'cover',
        file: { buffer: Buffer.from('not-an-image'), mimeType: 'image/jpeg', sizeBytes: 12 },
      }),
    ).rejects.toBeInstanceOf(InvalidRestaurantImageFileException);
  });

  it('does not point the restaurant at a file when storage fails', async () => {
    const ctx = createUseCase();
    const restaurantId = await seedRestaurant(ctx.restaurantRepository, ctx.restaurantSettingsRepository);
    ctx.storagePort.uploadShouldFail = true;
    await expect(
      ctx.useCase.execute({
        actorUserId: baseActor().userId,
        organizationId: baseActor().organizationId,
        restaurantId,
        slot: 'cover',
        file: jpeg(),
      }),
    ).rejects.toBeInstanceOf(RestaurantImageStorageUnavailableException);
    const saved = await ctx.restaurantRepository.findById(RestaurantId.create(restaurantId));
    expect(saved?.coverImageId).toBeNull();
  });

  it('keeps the new cover when deleting the previous object fails', async () => {
    const ctx = createUseCase([FILE_ID, REPLACEMENT_FILE_ID]);
    const restaurantId = await seedRestaurant(ctx.restaurantRepository, ctx.restaurantSettingsRepository);
    await ctx.useCase.execute({
      actorUserId: baseActor().userId,
      organizationId: baseActor().organizationId,
      restaurantId,
      slot: 'cover',
      file: jpeg(),
    });
    ctx.storagePort.deleteShouldFail = true;
    const replaced = await ctx.useCase.execute({
      actorUserId: baseActor().userId,
      organizationId: baseActor().organizationId,
      restaurantId,
      slot: 'cover',
      file: jpeg(),
    });
    expect(replaced.fileId).toBe(REPLACEMENT_FILE_ID);
    const saved = await ctx.restaurantRepository.findById(RestaurantId.create(restaurantId));
    expect(saved?.coverImageId).toBe(REPLACEMENT_FILE_ID);
  });
});
