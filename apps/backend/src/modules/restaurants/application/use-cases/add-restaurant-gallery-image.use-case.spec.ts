import { AddRestaurantGalleryImageUseCase } from './add-restaurant-gallery-image.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { MissingGalleryImageFileException } from '../../domain/exceptions/missing-gallery-image-file.exception';
import { GalleryImageFileTooLargeException } from '../../domain/exceptions/gallery-image-file-too-large.exception';
import { UnsupportedGalleryImageFileTypeException } from '../../domain/exceptions/unsupported-gallery-image-file-type.exception';
import { InvalidGalleryImageFileException } from '../../domain/exceptions/invalid-gallery-image-file.exception';
import { GalleryStorageUnavailableException } from '../../domain/exceptions/gallery-storage-unavailable.exception';
import { RestaurantGalleryLimitExceededException } from '../../domain/exceptions/restaurant-gallery-limit-exceeded.exception';
import { GALLERY_MAX_IMAGES_PER_RESTAURANT } from '../policies/gallery-upload.policy';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { FileRepository } from '@modules/files/domain/repositories/file.repository';
import { RestaurantGalleryRepository } from '../../domain/repositories/restaurant-gallery.repository';
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
import { InMemoryRestaurantGalleryRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-gallery.repository';
import { InMemoryFileRepository } from '../../../../../test/restaurants/support/in-memory-file-repository';
import { FakeStoragePort } from '../../../../../test/restaurants/support/fake-storage-port';

const BUCKET = 'tavla-public';

describe('AddRestaurantGalleryImageUseCase', () => {
  const fixedNow = new Date('2026-07-16T12:00:00.000Z');

  const validJpegBuffer = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(32, 0),
  ]);

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
      name: 'The Old Mill',
      description: null,
      cuisineType: null,
      priceLevel: null,
    });
    return result.restaurantId;
  }

  function createUseCase(overrides?: {
    galleryRepository?: InMemoryRestaurantGalleryRepository;
    fileRepository?: InMemoryFileRepository | FileRepository;
    storagePort?: FakeStoragePort;
    auditLogWriter?: CollectingAuditLogWriter;
    ids?: string[];
  }) {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const galleryRepository =
      overrides?.galleryRepository ?? new InMemoryRestaurantGalleryRepository();
    const fileRepository = overrides?.fileRepository ?? new InMemoryFileRepository();
    const storagePort = overrides?.storagePort ?? new FakeStoragePort();
    const auditLogWriter = overrides?.auditLogWriter ?? new CollectingAuditLogWriter();
    const idGenerator = new SequentialIdGenerator(
      overrides?.ids ?? [
        '66666666-6666-4666-8666-666666666666',
        '77777777-7777-4777-8777-777777777777',
      ],
    );

    const useCase = new AddRestaurantGalleryImageUseCase(
      restaurantRepository,
      galleryRepository,
      fileRepository,
      storagePort,
      new FixedClock(fixedNow),
      idGenerator,
      auditLogWriter,
      BUCKET,
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

  it('adds a first gallery image successfully', async () => {
    const {
      useCase,
      restaurantRepository,
      restaurantSettingsRepository,
      galleryRepository,
      storagePort,
      auditLogWriter,
    } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      file: { buffer: validJpegBuffer, mimeType: 'image/jpeg', sizeBytes: validJpegBuffer.length },
      caption: 'Our dining room',
    });

    expect(result.caption).toBe('Our dining room');
    expect(result.sortOrder).toBe(0);
    expect(result.imageUrl).toContain(BUCKET);

    expect(storagePort.uploaded).toHaveLength(1);
    expect(storagePort.uploaded[0].objectKey).toBe(
      `restaurants/${restaurantId}/gallery/66666666-6666-4666-8666-666666666666.jpg`,
    );

    const persisted = await galleryRepository.findAllByRestaurantId(
      RestaurantId.create(restaurantId),
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0].caption).toBe('Our dining room');

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: 'user-1',
      actorType: 'User',
      action: 'restaurant.gallery.image_added',
      targetId: restaurantId,
      organizationId: baseActor().organizationId,
    });
  });

  it('appends subsequent images with an incrementing sortOrder', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase({
      ids: [
        '66666666-6666-4666-8666-666666666666',
        '77777777-7777-4777-8777-777777777777',
        '88888888-8888-4888-8888-888888888888',
        '99999999-9999-4999-8999-999999999999',
      ],
    });
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    const first = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      file: { buffer: validJpegBuffer, mimeType: 'image/jpeg', sizeBytes: validJpegBuffer.length },
      caption: null,
    });
    const second = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      file: { buffer: validJpegBuffer, mimeType: 'image/jpeg', sizeBytes: validJpegBuffer.length },
      caption: null,
    });

    expect(first.sortOrder).toBe(0);
    expect(second.sortOrder).toBe(1);
  });

  it('rejects a 21st image with RestaurantGalleryLimitExceededException', async () => {
    // Each successful add() consumes 2 ids (fileId + gallery image id); the
    // 21st call is rejected before ever calling the id generator.
    const ids = Array.from(
      { length: GALLERY_MAX_IMAGES_PER_RESTAURANT * 2 },
      (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
    );
    const { useCase, restaurantRepository, restaurantSettingsRepository, galleryRepository } =
      createUseCase({
        ids,
      });
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    for (let i = 0; i < GALLERY_MAX_IMAGES_PER_RESTAURANT; i += 1) {
      await useCase.execute({
        actor: baseActor(),
        restaurantId,
        file: {
          buffer: validJpegBuffer,
          mimeType: 'image/jpeg',
          sizeBytes: validJpegBuffer.length,
        },
        caption: null,
      });
    }

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        file: {
          buffer: validJpegBuffer,
          mimeType: 'image/jpeg',
          sizeBytes: validJpegBuffer.length,
        },
        caption: null,
      }),
    ).rejects.toBeInstanceOf(RestaurantGalleryLimitExceededException);

    const all = await galleryRepository.findAllByRestaurantId(RestaurantId.create(restaurantId));
    expect(all).toHaveLength(GALLERY_MAX_IMAGES_PER_RESTAURANT);
  });

  it('rejects a missing file', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    await expect(
      useCase.execute({ actor: baseActor(), restaurantId, file: null, caption: null }),
    ).rejects.toBeInstanceOf(MissingGalleryImageFileException);
  });

  it('rejects an oversized file', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        file: { buffer: validJpegBuffer, mimeType: 'image/jpeg', sizeBytes: 6 * 1024 * 1024 },
        caption: null,
      }),
    ).rejects.toBeInstanceOf(GalleryImageFileTooLargeException);
  });

  it('rejects an unsupported declared MIME type', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        file: { buffer: validJpegBuffer, mimeType: 'image/gif', sizeBytes: validJpegBuffer.length },
        caption: null,
      }),
    ).rejects.toBeInstanceOf(UnsupportedGalleryImageFileTypeException);
  });

  it('rejects a file whose real bytes do not match a supported image signature', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    const htmlBuffer = Buffer.from('<html>not an image</html>', 'utf8');

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        file: { buffer: htmlBuffer, mimeType: 'image/png', sizeBytes: htmlBuffer.length },
        caption: null,
      }),
    ).rejects.toBeInstanceOf(InvalidGalleryImageFileException);
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const { useCase } = createUseCase();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        file: {
          buffer: validJpegBuffer,
          mimeType: 'image/jpeg',
          sizeBytes: validJpegBuffer.length,
        },
        caption: null,
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('maps a storage upload failure to GalleryStorageUnavailableException and persists nothing', async () => {
    const storagePort = new FakeStoragePort();
    storagePort.uploadShouldFail = true;
    const { useCase, restaurantRepository, restaurantSettingsRepository, galleryRepository } =
      createUseCase({
        storagePort,
      });
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        file: {
          buffer: validJpegBuffer,
          mimeType: 'image/jpeg',
          sizeBytes: validJpegBuffer.length,
        },
        caption: null,
      }),
    ).rejects.toBeInstanceOf(GalleryStorageUnavailableException);

    expect(
      await galleryRepository.findAllByRestaurantId(RestaurantId.create(restaurantId)),
    ).toHaveLength(0);
  });

  it('compensates by deleting the uploaded object when the Files-row persistence fails', async () => {
    const storagePort = new FakeStoragePort();
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    const failingFileRepository: FileRepository = {
      create: jest.fn().mockRejectedValue(new Error('db down')),
      findById: jest.fn().mockResolvedValue(null),
      findManyByIds: jest.fn().mockResolvedValue([]),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };

    const useCase = new AddRestaurantGalleryImageUseCase(
      restaurantRepository,
      new InMemoryRestaurantGalleryRepository(),
      failingFileRepository,
      storagePort,
      new FixedClock(fixedNow),
      new SequentialIdGenerator(['66666666-6666-4666-8666-666666666666']),
      new CollectingAuditLogWriter(),
      BUCKET,
    );

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        file: {
          buffer: validJpegBuffer,
          mimeType: 'image/jpeg',
          sizeBytes: validJpegBuffer.length,
        },
        caption: null,
      }),
    ).rejects.toThrow('db down');

    expect(storagePort.deleted).toContainEqual({
      bucket: BUCKET,
      objectKey: `restaurants/${restaurantId}/gallery/66666666-6666-4666-8666-666666666666.jpg`,
    });
  });

  it('compensates by removing the Files row and the uploaded object when gallery persistence fails', async () => {
    const storagePort = new FakeStoragePort();
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    const fileRepository = new InMemoryFileRepository();
    const softDeleteSpy = jest.spyOn(fileRepository, 'softDelete');
    const failingGalleryRepository: RestaurantGalleryRepository = {
      findAllByRestaurantId: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
      add: jest.fn().mockRejectedValue(new Error('gallery insert failed')),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const useCase = new AddRestaurantGalleryImageUseCase(
      restaurantRepository,
      failingGalleryRepository,
      fileRepository,
      storagePort,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([
        '66666666-6666-4666-8666-666666666666',
        '77777777-7777-4777-8777-777777777777',
      ]),
      new CollectingAuditLogWriter(),
      BUCKET,
    );

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        file: {
          buffer: validJpegBuffer,
          mimeType: 'image/jpeg',
          sizeBytes: validJpegBuffer.length,
        },
        caption: null,
      }),
    ).rejects.toThrow('gallery insert failed');

    expect(softDeleteSpy).toHaveBeenCalled();
    expect(storagePort.deleted).toContainEqual({
      bucket: BUCKET,
      objectKey: `restaurants/${restaurantId}/gallery/66666666-6666-4666-8666-666666666666.jpg`,
    });
  });
});
