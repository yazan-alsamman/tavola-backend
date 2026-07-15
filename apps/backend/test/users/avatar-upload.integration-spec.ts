import { randomUUID } from 'crypto';
import { PrismaClient, UserStatus } from '@prisma/client';
import { Client as MinioClient } from 'minio';
import { ConfigService } from '@nestjs/config';
import { PrismaUserRepository } from '@modules/authentication/infrastructure/persistence/prisma-user.repository';
import { PrismaFileRepository } from '@modules/files/infrastructure/persistence/prisma-file.repository';
import { MinioFileStorageService } from '@modules/files/infrastructure/storage/minio-file-storage.service';
import { UploadCurrentUserAvatarUseCase } from '@modules/users/application/use-cases/upload-current-user-avatar.use-case';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  isDatabaseReachable,
  isMinioReachable,
  resolveTestMinioConfig,
  skipUnlessDatabaseAvailable,
} from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';
import { CollectingAuditLogWriter } from '../authentication/support/in-memory-registration.dependencies';

const prisma = new PrismaClient();
const TEST_PREFIX = 'avatar-upload-integration-';
const BUCKET = process.env.MINIO_PUBLIC_BUCKET ?? 'tavla-public';

const validJpegBuffer = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 0)]);
const validPngBuffer = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 0),
]);

describe('Avatar upload round-trip through real PostgreSQL + MinIO (integration)', () => {
  let userRepository: PrismaUserRepository;
  let fileRepository: PrismaFileRepository;
  let minioClient: MinioClient;
  let useCase: UploadCurrentUserAvatarUseCase;
  let infraAvailable = false;
  const uploadedObjectKeys: string[] = [];

  beforeAll(async () => {
    const [dbAvailable, minioAvailable] = await Promise.all([
      isDatabaseReachable(),
      isMinioReachable(),
    ]);
    infraAvailable = dbAvailable && minioAvailable;
    if (skipUnlessDatabaseAvailable(infraAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaUserRepository,
      PrismaFileRepository,
    ]);
    userRepository = moduleRef.get(PrismaUserRepository);
    fileRepository = moduleRef.get(PrismaFileRepository);

    const minioTestConfig = resolveTestMinioConfig();
    minioClient = new MinioClient(minioTestConfig);
    const configService = {
      getOrThrow: () => ({
        signedUrlExpirySeconds: 3600,
        accessKey: minioTestConfig.accessKey,
        secretKey: minioTestConfig.secretKey,
        publicEndpoint: minioTestConfig.endPoint,
        publicPort: minioTestConfig.port,
        publicUseSSL: minioTestConfig.useSSL,
        region: 'us-east-1',
      }),
    } as unknown as ConfigService;
    const storagePort = new MinioFileStorageService(minioClient, configService);

    useCase = new UploadCurrentUserAvatarUseCase(
      userRepository,
      { now: () => new Date() },
      { generate: () => randomUUID() },
      fileRepository,
      storagePort,
      new CollectingAuditLogWriter(),
      BUCKET,
    );
  });

  afterAll(async () => {
    if (!infraAvailable) {
      return;
    }

    for (const objectKey of uploadedObjectKeys) {
      await minioClient.removeObject(BUCKET, objectKey).catch(() => undefined);
    }
    await prisma.file.deleteMany({ where: { objectKey: { contains: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  async function seedUser(): Promise<string> {
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Avatar',
        lastName: 'Tester',
        email: `${TEST_PREFIX}${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        phone: null,
        language: 'en',
        preferredCurrency: null,
        status: UserStatus.Active,
        emailVerified: true,
      },
    });
    return userId;
  }

  async function objectExists(objectKey: string): Promise<boolean> {
    try {
      await minioClient.statObject(BUCKET, objectKey);
      return true;
    } catch {
      return false;
    }
  }

  it('persists the Files row, uploads the real object, and points User.avatarId at it', async () => {
    if (!infraAvailable) return;
    const userId = await seedUser();

    const result = await useCase.execute({
      actor: {
        userId,
        sessionId: randomUUID(),
        sessionVersion: 1,
        tokenFamilyId: randomUUID(),
        actorType: AccessTokenActorType.User,
      },
      file: { buffer: validJpegBuffer, mimeType: 'image/jpeg', sizeBytes: validJpegBuffer.length },
      ipAddress: '203.0.113.5',
    });

    const objectKey = `avatars/${userId}/${result.avatarId}.jpg`;
    uploadedObjectKeys.push(objectKey);

    expect(await objectExists(objectKey)).toBe(true);

    const persistedAvatarId = await userRepository.getAvatarId(UserId.create(userId));
    expect(persistedAvatarId).toBe(result.avatarId);

    const fileRow = await prisma.file.findUnique({ where: { id: result.avatarId } });
    expect(fileRow).not.toBeNull();
    expect(fileRow?.ownerId).toBe(userId);
    expect(fileRow?.ownerType).toBe('User');
    expect(fileRow?.bucket).toBe(BUCKET);
    expect(fileRow?.mimeType).toBe('image/jpeg');
    expect(fileRow?.accessPolicy).toBe('Public');
    // Only metadata is persisted - no raw file bytes or storage credentials
    // ever land in a Postgres column.
    expect(JSON.stringify(fileRow)).not.toContain('ff d8 ff');
  });

  it('replaces the avatar and soft-deletes + removes the previous object after the new one persists', async () => {
    if (!infraAvailable) return;
    const userId = await seedUser();

    const first = await useCase.execute({
      actor: {
        userId,
        sessionId: randomUUID(),
        sessionVersion: 1,
        tokenFamilyId: randomUUID(),
        actorType: AccessTokenActorType.User,
      },
      file: { buffer: validJpegBuffer, mimeType: 'image/jpeg', sizeBytes: validJpegBuffer.length },
      ipAddress: '203.0.113.5',
    });
    const firstObjectKey = `avatars/${userId}/${first.avatarId}.jpg`;
    uploadedObjectKeys.push(firstObjectKey);
    expect(await objectExists(firstObjectKey)).toBe(true);

    const second = await useCase.execute({
      actor: {
        userId,
        sessionId: randomUUID(),
        sessionVersion: 1,
        tokenFamilyId: randomUUID(),
        actorType: AccessTokenActorType.User,
      },
      file: { buffer: validPngBuffer, mimeType: 'image/png', sizeBytes: validPngBuffer.length },
      ipAddress: '203.0.113.5',
    });
    const secondObjectKey = `avatars/${userId}/${second.avatarId}.png`;
    uploadedObjectKeys.push(secondObjectKey);

    expect(await userRepository.getAvatarId(UserId.create(userId))).toBe(second.avatarId);
    expect(await objectExists(secondObjectKey)).toBe(true);
    // Old object was actually deleted from MinIO, not just marked deleted in
    // the DB.
    expect(await objectExists(firstObjectKey)).toBe(false);

    const oldFileRow = await prisma.file.findUnique({ where: { id: first.avatarId } });
    expect(oldFileRow?.deletedAt).not.toBeNull();
  });

  it("keeps two different users' avatars fully isolated", async () => {
    if (!infraAvailable) return;
    const userA = await seedUser();
    const userB = await seedUser();

    const resultA = await useCase.execute({
      actor: {
        userId: userA,
        sessionId: randomUUID(),
        sessionVersion: 1,
        tokenFamilyId: randomUUID(),
        actorType: AccessTokenActorType.User,
      },
      file: { buffer: validJpegBuffer, mimeType: 'image/jpeg', sizeBytes: validJpegBuffer.length },
      ipAddress: '203.0.113.5',
    });
    uploadedObjectKeys.push(`avatars/${userA}/${resultA.avatarId}.jpg`);

    const resultB = await useCase.execute({
      actor: {
        userId: userB,
        sessionId: randomUUID(),
        sessionVersion: 1,
        tokenFamilyId: randomUUID(),
        actorType: AccessTokenActorType.User,
      },
      file: { buffer: validPngBuffer, mimeType: 'image/png', sizeBytes: validPngBuffer.length },
      ipAddress: '203.0.113.5',
    });
    uploadedObjectKeys.push(`avatars/${userB}/${resultB.avatarId}.png`);

    expect(await userRepository.getAvatarId(UserId.create(userA))).toBe(resultA.avatarId);
    expect(await userRepository.getAvatarId(UserId.create(userB))).toBe(resultB.avatarId);
    expect(await objectExists(`avatars/${userA}/${resultA.avatarId}.jpg`)).toBe(true);
    expect(await objectExists(`avatars/${userB}/${resultB.avatarId}.png`)).toBe(true);
  });
});
