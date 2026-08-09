import { AnonymizeUserAccountUseCase } from './anonymize-user-account.use-case';
import { RegistrationPolicy } from '@modules/authentication/domain/services/registration-policy';
import { UserStatus } from '@modules/authentication/domain/enums/authentication.enums';
import { UserAccountAnonymizedEvent } from '@modules/authentication/domain/events/authentication.events';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { UserId, FileId } from '@shared/domain/value-objects/identifiers.vo';
import { FileRepository } from '@modules/files/domain/repositories/file.repository';
import { FileRecord } from '@modules/files/domain/entities/file-record.entity';
import { StoragePort } from '@modules/files/application/ports/storage.port';
import { MessageRepository } from '@modules/messaging/domain/repositories/message.repository';
import { FavoriteRestaurantRepository } from '../../domain/repositories/favorite-restaurant.repository';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryUserRepository,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

const BUCKET = 'tavla-public';

class InMemoryFileRepository implements FileRepository {
  private readonly files = new Map<string, FileRecord>();
  async create(file: FileRecord): Promise<void> {
    this.files.set(file.fileId.value, file);
  }
  async findById(id: FileId): Promise<FileRecord | null> {
    return this.files.get(id.value) ?? null;
  }
  async findManyByIds(): Promise<FileRecord[]> {
    throw new Error('Not needed by this suite.');
  }
  async softDelete(id: FileId, at: Date): Promise<void> {
    const existing = this.files.get(id.value);
    if (existing) {
      this.files.set(id.value, existing.softDelete(at));
    }
  }
  seed(file: FileRecord): void {
    this.files.set(file.fileId.value, file);
  }
  get(id: string): FileRecord | undefined {
    return this.files.get(id);
  }
}

class FakeStoragePort implements StoragePort {
  readonly deleted: Array<{ bucket: string; objectKey: string }> = [];
  deleteShouldFail = false;
  async upload(): Promise<void> {
    throw new Error('Not needed by this suite.');
  }
  async delete(bucket: string, objectKey: string): Promise<void> {
    if (this.deleteShouldFail) {
      throw new Error('storage unreachable');
    }
    this.deleted.push({ bucket, objectKey });
  }
  async getSignedReadUrl(): Promise<string> {
    throw new Error('Not needed by this suite.');
  }
}

class FakeFavoriteRestaurantRepository implements FavoriteRestaurantRepository {
  readonly deletedForUserIds: string[] = [];
  async add(): Promise<never> {
    throw new Error('Not needed by this suite.');
  }
  async remove(): Promise<void> {
    throw new Error('Not needed by this suite.');
  }
  async findByUserAndRestaurant(): Promise<null> {
    throw new Error('Not needed by this suite.');
  }
  async listByUser(): Promise<never> {
    throw new Error('Not needed by this suite.');
  }
  async deleteAllByUserId(userId: UserId): Promise<void> {
    this.deletedForUserIds.push(userId.value);
  }
}

class FakeMessageRepository implements MessageRepository {
  readonly anonymizeCalls: Array<{ userId: string; at: Date }> = [];
  async create(): Promise<void> {
    throw new Error('Not needed by this suite.');
  }
  async findManyByConversationId(): Promise<never> {
    throw new Error('Not needed by this suite.');
  }
  async anonymizeAllBySenderUserId(userId: UserId, at: Date): Promise<void> {
    this.anonymizeCalls.push({ userId: userId.value, at });
  }
}

describe('AnonymizeUserAccountUseCase', () => {
  const now = new Date('2026-09-06T12:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';

  function build() {
    const userRepository = new InMemoryUserRepository();
    const favoriteRepository = new FakeFavoriteRestaurantRepository();
    const messageRepository = new FakeMessageRepository();
    const fileRepository = new InMemoryFileRepository();
    const storagePort = new FakeStoragePort();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new AnonymizeUserAccountUseCase(
      userRepository,
      favoriteRepository,
      messageRepository,
      fileRepository,
      storagePort,
      new ImmediateUnitOfWork(),
      eventPublisher,
      new FixedClock(now),
      new SequentialIdGenerator([
        'eeeeeeee-1111-4111-8111-111111111111',
        'eeeeeeee-2222-4222-8222-222222222222',
      ]),
    );
    return {
      useCase,
      userRepository,
      favoriteRepository,
      messageRepository,
      fileRepository,
      storagePort,
      eventPublisher,
    };
  }

  async function seedUser(userRepository: InMemoryUserRepository) {
    const user = RegistrationPolicy.createPendingUser({
      id: userId,
      email: Email.create('real-customer@example.com'),
      passwordHash: PasswordHash.create('argon2id$fake$hash'),
      firstName: 'Real',
      lastName: 'Customer',
      phone: '+15551234567',
      language: 'en',
      at: now,
    }).verifyEmail(now);
    await userRepository.save(user);
    return user;
  }

  it('scrubs the User row, deletes Favorites, and anonymizes Messages in one pass', async () => {
    const { useCase, userRepository, favoriteRepository, messageRepository } = build();
    await seedUser(userRepository);

    await useCase.execute({ userId });

    const updated = await userRepository.findById(UserId.create(userId));
    expect(updated?.status).toBe(UserStatus.Anonymized);
    expect(updated?.email?.value).toMatch(/^deleted-.+@anonymized\.local$/);
    expect(updated?.phone).toBeNull();
    expect(favoriteRepository.deletedForUserIds).toEqual([userId]);
    expect(messageRepository.anonymizeCalls).toEqual([{ userId, at: now }]);
  });

  it('publishes UserAccountAnonymizedEvent', async () => {
    const { useCase, userRepository, eventPublisher } = build();
    await seedUser(userRepository);

    await useCase.execute({ userId, correlationId: 'corr-anon-1' });

    const event = eventPublisher.events[0] as UserAccountAnonymizedEvent;
    expect(event).toBeInstanceOf(UserAccountAnonymizedEvent);
    expect(event.payload).toEqual({ userId });
    expect(event.correlationId).toBe('corr-anon-1');
  });

  it('clears the avatar pointer and deletes the underlying file when an avatar exists', async () => {
    const { useCase, userRepository, fileRepository, storagePort } = build();
    await seedUser(userRepository);
    await userRepository.updateAvatarId(
      UserId.create(userId),
      'aaaaaaaa-1111-4111-8111-111111111111',
      now,
    );
    fileRepository.seed(
      FileRecord.create({
        id: 'aaaaaaaa-1111-4111-8111-111111111111',
        ownerId: userId,
        ownerType: 'User',
        bucket: BUCKET,
        objectKey: `avatars/${userId}/aaaaaaaa-1111-4111-8111-111111111111.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: 500,
        accessPolicy: 'Public',
        createdAt: now,
        deletedAt: null,
      }),
    );

    await useCase.execute({ userId });

    expect(await userRepository.getAvatarId(UserId.create(userId))).toBeNull();
    expect(storagePort.deleted).toEqual([
      { bucket: BUCKET, objectKey: `avatars/${userId}/aaaaaaaa-1111-4111-8111-111111111111.jpg` },
    ]);
    expect(fileRepository.get('aaaaaaaa-1111-4111-8111-111111111111')?.deletedAt).toEqual(now);
  });

  it('still clears the avatar pointer even when the storage-layer delete fails (best-effort, matches cleanupOldAvatar precedent)', async () => {
    const { useCase, userRepository, fileRepository, storagePort } = build();
    await seedUser(userRepository);
    await userRepository.updateAvatarId(
      UserId.create(userId),
      'aaaaaaaa-1111-4111-8111-111111111111',
      now,
    );
    fileRepository.seed(
      FileRecord.create({
        id: 'aaaaaaaa-1111-4111-8111-111111111111',
        ownerId: userId,
        ownerType: 'User',
        bucket: BUCKET,
        objectKey: `avatars/${userId}/aaaaaaaa-1111-4111-8111-111111111111.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: 500,
        accessPolicy: 'Public',
        createdAt: now,
        deletedAt: null,
      }),
    );
    storagePort.deleteShouldFail = true;

    await expect(useCase.execute({ userId })).resolves.toBeUndefined();

    expect(await userRepository.getAvatarId(UserId.create(userId))).toBeNull();
  });

  it('is idempotent - a retried/duplicate job against an already-anonymized account is a silent no-op, no second event', async () => {
    const { useCase, userRepository, eventPublisher } = build();
    await seedUser(userRepository);
    await useCase.execute({ userId });
    expect(eventPublisher.events).toHaveLength(1);

    await useCase.execute({ userId });

    expect(eventPublisher.events).toHaveLength(1);
  });

  it('is a safe no-op when the User row does not exist', async () => {
    const { useCase } = build();

    await expect(useCase.execute({ userId })).resolves.toBeUndefined();
  });
});
