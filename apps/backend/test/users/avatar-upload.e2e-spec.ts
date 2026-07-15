import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { Client as MinioClient } from 'minio';
import { createTestApp } from '../helpers/test-app.factory';
import { Argon2PasswordHasher } from '@modules/authentication/infrastructure/security/argon2-password-hasher';
import { Password } from '@shared/domain/value-objects/password.vo';
import authConfig from '@config/auth.config';
import {
  isDatabaseReachable,
  isMinioReachable,
  resolveTestMinioConfig,
  skipUnlessDatabaseAvailable,
} from '../support/live-database';

const prisma = new PrismaClient();
const TEST_PREFIX = 'avatar-upload-e2e-';
const PASSWORD = 'SecurePass123!';
const ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
const BUCKET = process.env.MINIO_PUBLIC_BUCKET ?? 'tavla-public';

const validJpegBuffer = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0)]);
const validPngBuffer = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0),
]);

function uniqueId(): string {
  return randomUUID().split('-')[0];
}

describe('POST /api/v1/users/me/avatar (e2e)', () => {
  let app: INestApplication | undefined;
  let infraAvailable = false;
  let passwordHash = 'argon2id$test';
  let minioClient: MinioClient;

  beforeAll(async () => {
    const [dbAvailable, minioAvailable] = await Promise.all([
      isDatabaseReachable(),
      isMinioReachable(),
    ]);
    infraAvailable = dbAvailable && minioAvailable;
    if (skipUnlessDatabaseAvailable(infraAvailable)) {
      console.warn('PostgreSQL/MinIO not reachable — avatar upload e2e tests NOT EXECUTED.');
      return;
    }

    process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';
    process.env.ARGON2_MEMORY_COST = '4096';
    process.env.ARGON2_TIME_COST = '1';

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [authConfig] })],
      providers: [Argon2PasswordHasher],
    }).compile();
    const hasher = moduleRef.get(Argon2PasswordHasher);
    passwordHash = (await hasher.hash(Password.create(PASSWORD))).value;

    minioClient = new MinioClient(resolveTestMinioConfig());
    app = await createTestApp();
  });

  afterAll(async () => {
    if (infraAvailable) {
      // Avatar object keys are UUID-based and don't embed TEST_PREFIX, so
      // cleanup is scoped by owning user id instead (bucket-prefix scan per
      // user, then the Files rows for those same owners).
      const users = await prisma.user.findMany({
        where: { email: { startsWith: TEST_PREFIX } },
        select: { id: true },
      });
      for (const user of users) {
        const stream = minioClient.listObjectsV2(BUCKET, `avatars/${user.id}/`, true);
        const keys: string[] = await new Promise((resolve, reject) => {
          const collected: string[] = [];
          stream.on('data', (obj) => {
            if (obj.name) collected.push(obj.name);
          });
          stream.on('end', () => resolve(collected));
          stream.on('error', reject);
        });
        for (const key of keys) {
          await minioClient.removeObject(BUCKET, key).catch(() => undefined);
        }
      }
      await prisma.file.deleteMany({ where: { ownerId: { in: users.map((u) => u.id) } } });
      await prisma.deviceSession.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.tokenFamily.deleteMany({
        where: { user: { email: { startsWith: TEST_PREFIX } } },
      });
      await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.$disconnect();
    }
    if (app) {
      await app.close();
    }
  });

  async function createAndLoginUser(
    suffix: string,
  ): Promise<{ accessToken: string; email: string; userId: string }> {
    const email = `${TEST_PREFIX}${suffix}-${uniqueId()}@example.com`;
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Avatar',
        lastName: 'Tester',
        email,
        phone: null,
        passwordHash,
        language: 'en',
        preferredCurrency: null,
        status: UserStatus.Active,
        emailVerified: true,
      },
    });

    const loginResponse = await request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, deviceType: 'web' })
      .expect(200);
    const accessToken = loginResponse.body.data.accessToken as string;

    return { accessToken, email, userId };
  }

  it('uploads a JPEG avatar successfully and returns a signed URL', async () => {
    if (!infraAvailable || !app) return;
    const { accessToken, userId } = await createAndLoginUser('success');

    const response = await request(app.getHttpServer())
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', validJpegBuffer, { filename: 'avatar.jpg', contentType: 'image/jpeg' })
      .expect(200);

    expect(response.body.data.avatarId).toBeTruthy();
    expect(response.body.data.mimeType).toBe('image/jpeg');
    expect(response.body.data.avatarUrl).toContain(BUCKET);

    const persisted = await prisma.user.findUnique({ where: { id: userId } });
    expect(persisted?.avatarId).toBe(response.body.data.avatarId);
  });

  it('replaces an existing avatar on a second upload', async () => {
    if (!infraAvailable || !app) return;
    const { accessToken, userId } = await createAndLoginUser('replace');

    const first = await request(app.getHttpServer())
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', validJpegBuffer, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(200);

    const second = await request(app.getHttpServer())
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', validPngBuffer, { filename: 'b.png', contentType: 'image/png' })
      .expect(200);

    expect(second.body.data.avatarId).not.toBe(first.body.data.avatarId);

    const persisted = await prisma.user.findUnique({ where: { id: userId } });
    expect(persisted?.avatarId).toBe(second.body.data.avatarId);

    const oldFile = await prisma.file.findUnique({ where: { id: first.body.data.avatarId } });
    expect(oldFile?.deletedAt).not.toBeNull();
  });

  it('rejects a request with no file attached', async () => {
    if (!infraAvailable || !app) return;
    const { accessToken } = await createAndLoginUser('missing-file');

    const response = await request(app.getHttpServer())
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
    expect(['VALIDATION_ERROR', 'INVALID_FILE']).toContain(response.body.code);
  });

  it('rejects an oversized file with 413', async () => {
    if (!infraAvailable || !app) return;
    const { accessToken } = await createAndLoginUser('oversized');
    const oversized = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(6 * 1024 * 1024, 0),
    ]);

    const response = await request(app.getHttpServer())
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', oversized, { filename: 'big.jpg', contentType: 'image/jpeg' })
      .expect(413);
    expect(response.body.code).toBe('FILE_TOO_LARGE');
  });

  it('rejects an unsupported file type (GIF) with 415', async () => {
    if (!infraAvailable || !app) return;
    const { accessToken } = await createAndLoginUser('unsupported');
    const gifBuffer = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(16, 0)]);

    const response = await request(app.getHttpServer())
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', gifBuffer, { filename: 'avatar.gif', contentType: 'image/gif' })
      .expect(415);
    expect(response.body.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects a spoofed Content-Type where the declared type does not match the real bytes', async () => {
    if (!infraAvailable || !app) return;
    const { accessToken } = await createAndLoginUser('spoofed');
    // real bytes are HTML, declared Content-Type/extension claim JPEG
    const htmlBuffer = Buffer.from('<html><body>evil</body></html>', 'utf8');

    const response = await request(app.getHttpServer())
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', htmlBuffer, { filename: 'avatar.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect(response.body.code).toBe('INVALID_FILE');
  });

  it('rejects a request with no Authorization header', async () => {
    if (!infraAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .post('/api/v1/users/me/avatar')
      .attach('file', validJpegBuffer, { filename: 'avatar.jpg', contentType: 'image/jpeg' })
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('rejects an invalid access token', async () => {
    if (!infraAvailable || !app) return;

    const response = await request(app.getHttpServer())
      .post('/api/v1/users/me/avatar')
      .set('Authorization', 'Bearer not-a-real-token')
      .attach('file', validJpegBuffer, { filename: 'avatar.jpg', contentType: 'image/jpeg' })
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('rejects a stale access token after logout-all bumps sessionVersion', async () => {
    if (!infraAvailable || !app) return;
    const { accessToken } = await createAndLoginUser('stale-session');

    await request(app.getHttpServer())
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const response = await request(app.getHttpServer())
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', validJpegBuffer, { filename: 'avatar.jpg', contentType: 'image/jpeg' })
      .expect(401);
    expect(response.body.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('rejects an expired access token', async () => {
    if (!infraAvailable || !app) return;

    const expiredToken = jwt.sign(
      {
        sub: randomUUID(),
        actorType: 'User',
        sessionId: randomUUID(),
        sessionVersion: 1,
        tokenFamilyId: randomUUID(),
      },
      ACCESS_SECRET,
      {
        algorithm: 'HS256',
        issuer: 'tavla-api',
        audience: 'tavla-clients',
        expiresIn: -10,
        keyid: 'current',
      },
    );

    const response = await request(app.getHttpServer())
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${expiredToken}`)
      .attach('file', validJpegBuffer, { filename: 'avatar.jpg', contentType: 'image/jpeg' })
      .expect(401);
    expect(response.body.code).toBe('AUTH_EXPIRED_TOKEN');
  });

  it('a forged JWT for a different userId cannot redirect the upload to another account', async () => {
    if (!infraAvailable || !app) return;
    const victim = await createAndLoginUser('victim');
    const attacker = await createAndLoginUser('attacker');

    // Attacker uploads normally with their own valid token; the endpoint has
    // no body/query/header field for a target userId at all, so there is no
    // way to redirect the upload even by attempting to smuggle one.
    const response = await request(app.getHttpServer())
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .set('X-User-Id', victim.userId)
      .query({ userId: victim.userId, organizationId: randomUUID() })
      .attach('file', validJpegBuffer, { filename: 'avatar.jpg', contentType: 'image/jpeg' })
      .expect(200);

    const attackerRow = await prisma.user.findUnique({ where: { id: attacker.userId } });
    const victimRow = await prisma.user.findUnique({ where: { id: victim.userId } });
    expect(attackerRow?.avatarId).toBe(response.body.data.avatarId);
    expect(victimRow?.avatarId).toBeNull();
  });

  it("uploading twice by two different users never touches the other user's avatar", async () => {
    if (!infraAvailable || !app) return;
    const userA = await createAndLoginUser('isolation-a');
    const userB = await createAndLoginUser('isolation-b');

    const responseA = await request(app.getHttpServer())
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .attach('file', validJpegBuffer, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(200);

    const responseB = await request(app.getHttpServer())
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .attach('file', validPngBuffer, { filename: 'b.png', contentType: 'image/png' })
      .expect(200);

    const rowA = await prisma.user.findUnique({ where: { id: userA.userId } });
    const rowB = await prisma.user.findUnique({ where: { id: userB.userId } });
    expect(rowA?.avatarId).toBe(responseA.body.data.avatarId);
    expect(rowB?.avatarId).toBe(responseB.body.data.avatarId);
    expect(rowA?.avatarId).not.toBe(rowB?.avatarId);
  });

  it('never exposes internal storage credentials or bucket secrets in the response', async () => {
    if (!infraAvailable || !app) return;
    const { accessToken } = await createAndLoginUser('no-secrets');

    const response = await request(app.getHttpServer())
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', validJpegBuffer, { filename: 'avatar.jpg', contentType: 'image/jpeg' })
      .expect(200);

    // SigV4 presigned URLs embed the access key ID by design (it identifies
    // which key signed the request, same as any AWS S3 presigned URL) - only
    // the secret key itself (never transmitted, only used to derive the
    // signature) must never appear.
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('tavla_minio_secret');
    expect(response.body.data).not.toHaveProperty('bucket');
    expect(response.body.data).not.toHaveProperty('accessKey');
    expect(response.body.data).not.toHaveProperty('secretKey');
  });

  it('ignores unrelated mass-assignment fields sent alongside the multipart file', async () => {
    if (!infraAvailable || !app) return;
    const { accessToken, userId, email } = await createAndLoginUser('mass-assignment');

    const response = await request(app.getHttpServer())
      .post('/api/v1/users/me/avatar')
      .set('Authorization', `Bearer ${accessToken}`)
      .field('userId', randomUUID())
      .field('email', 'attacker@example.com')
      .field('sessionVersion', '999')
      .attach('file', validJpegBuffer, { filename: 'avatar.jpg', contentType: 'image/jpeg' })
      .expect(200);

    expect(response.body.data.avatarId).toBeTruthy();
    const persisted = await prisma.user.findUnique({ where: { id: userId } });
    expect(persisted?.email).toBe(email);
    expect(persisted?.sessionVersion).toBe(1);
  });
});
