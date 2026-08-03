import { UploadCurrentUserAvatarUseCase } from './upload-current-user-avatar.use-case';
import { RegistrationPolicy } from '@modules/authentication/domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { FileId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { UserNotFoundException } from '@modules/authentication/application/exceptions/user-not-found.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { FileRepository } from '@modules/files/domain/repositories/file.repository';
import { FileRecord } from '@modules/files/domain/entities/file-record.entity';
import { StoragePort, UploadObjectInput } from '@modules/files/application/ports/storage.port';
import { MissingAvatarFileException } from '../exceptions/missing-avatar-file.exception';
import { AvatarFileTooLargeException } from '../exceptions/avatar-file-too-large.exception';
import { UnsupportedAvatarFileTypeException } from '../exceptions/unsupported-avatar-file-type.exception';
import { InvalidAvatarFileException } from '../exceptions/invalid-avatar-file.exception';
import { AvatarStorageUnavailableException } from '../exceptions/avatar-storage-unavailable.exception';
import {
  CollectingAuditLogWriter,
  FixedClock,
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

  async findManyByIds(ids: FileId[]): Promise<FileRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    const uniqueIds = [...new Set(ids.map((id) => id.value))];
    return uniqueIds
      .map((id) => this.files.get(id))
      .filter((file): file is FileRecord => file !== undefined);
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
  readonly uploaded: UploadObjectInput[] = [];
  readonly deleted: Array<{ bucket: string; objectKey: string }> = [];
  uploadShouldFail = false;
  deleteShouldFail = false;

  async upload(input: UploadObjectInput): Promise<void> {
    if (this.uploadShouldFail) {
      throw new Error('storage unreachable');
    }
    this.uploaded.push(input);
  }

  async delete(bucket: string, objectKey: string): Promise<void> {
    if (this.deleteShouldFail) {
      throw new Error('delete failed');
    }
    this.deleted.push({ bucket, objectKey });
  }

  async getSignedReadUrl(bucket: string, objectKey: string): Promise<string> {
    return `https://signed.example.com/${bucket}/${objectKey}`;
  }
}

describe('UploadCurrentUserAvatarUseCase', () => {
  const fixedNow = new Date('2026-07-14T12:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '55555555-5555-4555-8555-555555555555';

  const validJpegBuffer = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.alloc(32, 0),
  ]);
  const validPngBuffer = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32, 0),
  ]);

  function baseActor(id: string = userId) {
    return {
      userId: id,
      sessionId: '22222222-2222-4222-8222-222222222222',
      sessionVersion: 1,
      tokenFamilyId: '33333333-3333-4333-8333-333333333333',
      actorType: AccessTokenActorType.User as const,
    };
  }

  function createUseCase(overrides?: {
    userRepository?: InMemoryUserRepository;
    fileRepository?: InMemoryFileRepository;
    storagePort?: FakeStoragePort;
    auditLogWriter?: CollectingAuditLogWriter;
    ids?: string[];
  }) {
    const userRepository = overrides?.userRepository ?? new InMemoryUserRepository();
    const fileRepository = overrides?.fileRepository ?? new InMemoryFileRepository();
    const storagePort = overrides?.storagePort ?? new FakeStoragePort();
    const auditLogWriter = overrides?.auditLogWriter ?? new CollectingAuditLogWriter();
    const idGenerator = new SequentialIdGenerator(
      overrides?.ids ?? ['66666666-6666-4666-8666-666666666666'],
    );

    const useCase = new UploadCurrentUserAvatarUseCase(
      userRepository,
      new FixedClock(fixedNow),
      idGenerator,
      fileRepository,
      storagePort,
      auditLogWriter,
      BUCKET,
    );

    return { useCase, userRepository, fileRepository, storagePort, auditLogWriter };
  }

  async function seedUser(userRepository: InMemoryUserRepository, id: string = userId) {
    const user = RegistrationPolicy.createPendingUser({
      id,
      email: Email.create(`${id}@example.com`),
      passwordHash: PasswordHash.create('argon2id$fake$SecurePass123!'),
      firstName: 'Jane',
      lastName: 'Doe',
      phone: null,
      language: 'en',
      at: fixedNow,
    }).verifyEmail(fixedNow);
    await userRepository.save(user);
  }

  it('uploads a first avatar successfully', async () => {
    const { useCase, userRepository, fileRepository, storagePort, auditLogWriter } =
      createUseCase();
    await seedUser(userRepository);

    const result = await useCase.execute({
      actor: baseActor(),
      file: { buffer: validJpegBuffer, mimeType: 'image/jpeg', sizeBytes: validJpegBuffer.length },
      ipAddress: '203.0.113.5',
      correlationId: 'corr-1',
    });

    expect(result.avatarId).toBe('66666666-6666-4666-8666-666666666666');
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.avatarUrl).toContain(BUCKET);

    expect(storagePort.uploaded).toHaveLength(1);
    expect(storagePort.uploaded[0].objectKey).toBe(
      `avatars/${userId}/66666666-6666-4666-8666-666666666666.jpg`,
    );

    const persisted = fileRepository.get('66666666-6666-4666-8666-666666666666');
    expect(persisted?.ownerId).toBe(userId);
    expect(persisted?.ownerType).toBe('User');
    expect(persisted?.accessPolicy).toBe('Public');

    expect(await userRepository.getAvatarId(UserId.create(userId))).toBe(
      '66666666-6666-4666-8666-666666666666',
    );

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: userId,
      actorType: 'User',
      action: 'user.avatar.uploaded',
      correlationId: 'corr-1',
    });
  });

  it('replaces an existing avatar and cleans up the old object only after the new one persists', async () => {
    const { useCase, userRepository, fileRepository, storagePort } = createUseCase({
      ids: ['77777777-7777-4777-8777-777777777777'],
    });
    await seedUser(userRepository);

    const oldFile = FileRecord.create({
      id: '88888888-8888-4888-8888-888888888888',
      ownerId: userId,
      ownerType: 'User',
      bucket: BUCKET,
      objectKey: `avatars/${userId}/old.png`,
      mimeType: 'image/png',
      sizeBytes: 500,
      accessPolicy: 'Public',
      createdAt: fixedNow,
      deletedAt: null,
    });
    fileRepository.seed(oldFile);
    await userRepository.updateAvatarId(UserId.create(userId), oldFile.fileId.value, fixedNow);

    await useCase.execute({
      actor: baseActor(),
      file: { buffer: validPngBuffer, mimeType: 'image/png', sizeBytes: validPngBuffer.length },
      ipAddress: '203.0.113.5',
    });

    expect(await userRepository.getAvatarId(UserId.create(userId))).toBe(
      '77777777-7777-4777-8777-777777777777',
    );

    const oldAfter = fileRepository.get('88888888-8888-4888-8888-888888888888');
    expect(oldAfter?.isDeleted()).toBe(true);
    expect(storagePort.deleted).toContainEqual({
      bucket: BUCKET,
      objectKey: `avatars/${userId}/old.png`,
    });

    // the new object was uploaded, never deleted
    expect(
      storagePort.deleted.some((d) => d.objectKey.includes('77777777-7777-4777-8777-777777777777')),
    ).toBe(false);
  });

  it("never touches another user's avatar object", async () => {
    const { useCase, userRepository, fileRepository, storagePort } = createUseCase();
    await seedUser(userRepository, userId);
    await seedUser(userRepository, otherUserId);

    const otherUsersFile = FileRecord.create({
      id: '99999999-9999-4999-8999-999999999999',
      ownerId: otherUserId,
      ownerType: 'User',
      bucket: BUCKET,
      objectKey: `avatars/${otherUserId}/theirs.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 500,
      accessPolicy: 'Public',
      createdAt: fixedNow,
      deletedAt: null,
    });
    fileRepository.seed(otherUsersFile);
    await userRepository.updateAvatarId(
      UserId.create(otherUserId),
      otherUsersFile.fileId.value,
      fixedNow,
    );

    await useCase.execute({
      actor: baseActor(userId),
      file: { buffer: validJpegBuffer, mimeType: 'image/jpeg', sizeBytes: validJpegBuffer.length },
      ipAddress: '203.0.113.5',
    });

    expect(fileRepository.get('99999999-9999-4999-8999-999999999999')?.isDeleted()).toBe(false);
    expect(storagePort.deleted).toHaveLength(0);
    expect(await userRepository.getAvatarId(UserId.create(otherUserId))).toBe(
      '99999999-9999-4999-8999-999999999999',
    );
  });

  it('throws UserNotFoundException when the actor has no matching user', async () => {
    const { useCase } = createUseCase();

    await expect(
      useCase.execute({
        actor: baseActor(),
        file: {
          buffer: validJpegBuffer,
          mimeType: 'image/jpeg',
          sizeBytes: validJpegBuffer.length,
        },
        ipAddress: '203.0.113.5',
      }),
    ).rejects.toBeInstanceOf(UserNotFoundException);
  });

  it('rejects a missing file', async () => {
    const { useCase, userRepository } = createUseCase();
    await seedUser(userRepository);

    await expect(
      useCase.execute({ actor: baseActor(), file: null, ipAddress: '203.0.113.5' }),
    ).rejects.toBeInstanceOf(MissingAvatarFileException);
  });

  it('rejects an oversized file', async () => {
    const { useCase, userRepository } = createUseCase();
    await seedUser(userRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        file: { buffer: validJpegBuffer, mimeType: 'image/jpeg', sizeBytes: 6 * 1024 * 1024 },
        ipAddress: '203.0.113.5',
      }),
    ).rejects.toBeInstanceOf(AvatarFileTooLargeException);
  });

  it('rejects an unsupported declared MIME type', async () => {
    const { useCase, userRepository } = createUseCase();
    await seedUser(userRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        file: { buffer: validJpegBuffer, mimeType: 'image/gif', sizeBytes: validJpegBuffer.length },
        ipAddress: '203.0.113.5',
      }),
    ).rejects.toBeInstanceOf(UnsupportedAvatarFileTypeException);
  });

  it('rejects a file whose real bytes do not match a supported image signature', async () => {
    const { useCase, userRepository } = createUseCase();
    await seedUser(userRepository);
    const htmlBuffer = Buffer.from('<html>not an image</html>', 'utf8');

    await expect(
      useCase.execute({
        actor: baseActor(),
        file: { buffer: htmlBuffer, mimeType: 'image/png', sizeBytes: htmlBuffer.length },
        ipAddress: '203.0.113.5',
      }),
    ).rejects.toBeInstanceOf(InvalidAvatarFileException);
  });

  it('rejects a spoofed Content-Type where the declared type does not match the real signature', async () => {
    const { useCase, userRepository } = createUseCase();
    await seedUser(userRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        // real bytes are PNG, declared type is jpeg
        file: { buffer: validPngBuffer, mimeType: 'image/jpeg', sizeBytes: validPngBuffer.length },
        ipAddress: '203.0.113.5',
      }),
    ).rejects.toBeInstanceOf(InvalidAvatarFileException);
  });

  it('maps a storage upload failure to AvatarStorageUnavailableException and persists nothing', async () => {
    const storagePort = new FakeStoragePort();
    storagePort.uploadShouldFail = true;
    const { useCase, userRepository, fileRepository } = createUseCase({ storagePort });
    await seedUser(userRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        file: {
          buffer: validJpegBuffer,
          mimeType: 'image/jpeg',
          sizeBytes: validJpegBuffer.length,
        },
        ipAddress: '203.0.113.5',
      }),
    ).rejects.toBeInstanceOf(AvatarStorageUnavailableException);

    expect(await userRepository.getAvatarId(UserId.create(userId))).toBeNull();
    expect(fileRepository.get('66666666-6666-4666-8666-666666666666')).toBeUndefined();
  });

  it('compensates by deleting the uploaded object when Files-row persistence fails', async () => {
    const storagePort = new FakeStoragePort();
    const userRepository = new InMemoryUserRepository();
    await seedUser(userRepository);
    const failingFileRepository: FileRepository = {
      create: jest.fn().mockRejectedValue(new Error('db down')),
      findById: jest.fn().mockResolvedValue(null),
      findManyByIds: jest.fn().mockResolvedValue([]),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };

    const useCase = new UploadCurrentUserAvatarUseCase(
      userRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator(['66666666-6666-4666-8666-666666666666']),
      failingFileRepository,
      storagePort,
      new CollectingAuditLogWriter(),
      BUCKET,
    );

    await expect(
      useCase.execute({
        actor: baseActor(),
        file: {
          buffer: validJpegBuffer,
          mimeType: 'image/jpeg',
          sizeBytes: validJpegBuffer.length,
        },
        ipAddress: '203.0.113.5',
      }),
    ).rejects.toThrow('db down');

    expect(storagePort.deleted).toContainEqual({
      bucket: BUCKET,
      objectKey: `avatars/${userId}/66666666-6666-4666-8666-666666666666.jpg`,
    });
    expect(await userRepository.getAvatarId(UserId.create(userId))).toBeNull();
  });

  it('compensates by removing the Files row and the uploaded object when updateAvatarId fails', async () => {
    const storagePort = new FakeStoragePort();
    const failingUserRepository = new InMemoryUserRepository();
    await seedUser(failingUserRepository);
    jest
      .spyOn(failingUserRepository, 'updateAvatarId')
      .mockRejectedValueOnce(new Error('update failed'));
    const fileRepository = new InMemoryFileRepository();
    const softDeleteSpy = jest.spyOn(fileRepository, 'softDelete');

    const useCase = new UploadCurrentUserAvatarUseCase(
      failingUserRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator(['66666666-6666-4666-8666-666666666666']),
      fileRepository,
      storagePort,
      new CollectingAuditLogWriter(),
      BUCKET,
    );

    await expect(
      useCase.execute({
        actor: baseActor(),
        file: {
          buffer: validJpegBuffer,
          mimeType: 'image/jpeg',
          sizeBytes: validJpegBuffer.length,
        },
        ipAddress: '203.0.113.5',
      }),
    ).rejects.toThrow('update failed');

    expect(softDeleteSpy).toHaveBeenCalledWith(
      expect.objectContaining({ value: '66666666-6666-4666-8666-666666666666' }),
      fixedNow,
    );
    expect(storagePort.deleted).toContainEqual({
      bucket: BUCKET,
      objectKey: `avatars/${userId}/66666666-6666-4666-8666-666666666666.jpg`,
    });
  });

  it('does not fail the request when old-object cleanup fails, and the new avatar is still live', async () => {
    const storagePort = new FakeStoragePort();
    const { useCase, userRepository, fileRepository } = createUseCase({
      storagePort,
      ids: ['77777777-7777-4777-8777-777777777777'],
    });
    await seedUser(userRepository);

    const oldFile = FileRecord.create({
      id: '88888888-8888-4888-8888-888888888888',
      ownerId: userId,
      ownerType: 'User',
      bucket: BUCKET,
      objectKey: `avatars/${userId}/old.png`,
      mimeType: 'image/png',
      sizeBytes: 500,
      accessPolicy: 'Public',
      createdAt: fixedNow,
      deletedAt: null,
    });
    fileRepository.seed(oldFile);
    await userRepository.updateAvatarId(UserId.create(userId), oldFile.fileId.value, fixedNow);

    // fail only deletes issued for the OLD object; allow the initial upload to succeed
    const originalDelete = storagePort.delete.bind(storagePort);
    jest.spyOn(storagePort, 'delete').mockImplementation(async (bucket, objectKey) => {
      if (objectKey === oldFile.objectKey) {
        throw new Error('cleanup failed');
      }
      return originalDelete(bucket, objectKey);
    });

    const result = await useCase.execute({
      actor: baseActor(),
      file: { buffer: validPngBuffer, mimeType: 'image/png', sizeBytes: validPngBuffer.length },
      ipAddress: '203.0.113.5',
    });

    expect(result.avatarId).toBe('77777777-7777-4777-8777-777777777777');
    expect(await userRepository.getAvatarId(UserId.create(userId))).toBe(
      '77777777-7777-4777-8777-777777777777',
    );
  });

  it('never writes an audit entry when persistence fails before completion', async () => {
    const auditLogWriter = new CollectingAuditLogWriter();
    const storagePort = new FakeStoragePort();
    const userRepository = new InMemoryUserRepository();
    await seedUser(userRepository);
    const failingFileRepository: FileRepository = {
      create: jest.fn().mockRejectedValue(new Error('db down')),
      findById: jest.fn().mockResolvedValue(null),
      findManyByIds: jest.fn().mockResolvedValue([]),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };

    const useCase = new UploadCurrentUserAvatarUseCase(
      userRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator(['66666666-6666-4666-8666-666666666666']),
      failingFileRepository,
      storagePort,
      auditLogWriter,
      BUCKET,
    );

    await expect(
      useCase.execute({
        actor: baseActor(),
        file: {
          buffer: validJpegBuffer,
          mimeType: 'image/jpeg',
          sizeBytes: validJpegBuffer.length,
        },
        ipAddress: '203.0.113.5',
      }),
    ).rejects.toThrow();

    expect(auditLogWriter.entries).toHaveLength(0);
  });
});
