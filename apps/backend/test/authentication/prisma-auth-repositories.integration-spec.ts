import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  PrismaEmailVerificationRepository,
  PrismaUserRepository,
} from '@modules/authentication/infrastructure/persistence/prisma-user.repository';
import { Sha256OpaqueTokenService } from '@modules/authentication/infrastructure/security/sha256-opaque-token.service';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const prisma = new PrismaClient();
const TEST_PREFIX = 'verify-email-repo-';

describe('Prisma authentication repositories (integration)', () => {
  let userRepository: PrismaUserRepository;
  let emailVerificationRepository: PrismaEmailVerificationRepository;
  const opaqueTokenService = new Sha256OpaqueTokenService();
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaUserRepository,
      PrismaEmailVerificationRepository,
    ]);

    userRepository = moduleRef.get(PrismaUserRepository);
    emailVerificationRepository = moduleRef.get(PrismaEmailVerificationRepository);
  });

  afterAll(async () => {
    if (!dbAvailable) {
      return;
    }

    await prisma.emailVerificationToken.deleteMany({
      where: { user: { email: { startsWith: TEST_PREFIX } } },
    });
    await prisma.user.deleteMany({
      where: { email: { startsWith: TEST_PREFIX } },
    });
    await prisma.$disconnect();
  });

  it('finds token by hash and consumes atomically only once', async () => {
    if (!dbAvailable) {
      return;
    }

    const userId = randomUUID();
    const tokenId = randomUUID();
    const opaque = `repo-token-${randomUUID()}`;
    const tokenHash = opaqueTokenService.hash(opaque);

    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Repo',
        lastName: 'Test',
        email: `${TEST_PREFIX}@example.com`,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: UserStatus.Pending,
        emailVerified: false,
      },
    });

    await emailVerificationRepository.save({
      id: tokenId,
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 3_600_000),
      consumedAt: null,
      createdAt: new Date(),
    });

    const found = await emailVerificationRepository.findByTokenHash(tokenHash);
    expect(found?.id).toBe(tokenId);

    const firstConsume = await emailVerificationRepository.consumeIfActive(tokenId, new Date());
    const secondConsume = await emailVerificationRepository.consumeIfActive(tokenId, new Date());

    expect(firstConsume).toBe(true);
    expect(secondConsume).toBe(false);

    const user = await userRepository.findById(UserId.create(userId));
    expect(user).not.toBeNull();
  });
});
