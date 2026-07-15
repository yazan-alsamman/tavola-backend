import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaUserRepository } from '@modules/authentication/infrastructure/persistence/prisma-user.repository';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const prisma = new PrismaClient();
const TEST_PREFIX = 'user-preferences-repo-';

describe('User preferences round-trip via PrismaUserRepository (integration)', () => {
  let userRepository: PrismaUserRepository;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaUserRepository]);
    userRepository = moduleRef.get(PrismaUserRepository);
  });

  afterAll(async () => {
    if (!dbAvailable) {
      return;
    }

    await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  it('defaults new rows to notificationOptIn=true, marketingOptIn=false without the application specifying them', async () => {
    if (!dbAvailable) {
      return;
    }

    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Repo',
        lastName: 'Test',
        email: `${TEST_PREFIX}${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        phone: null,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });

    const user = await userRepository.findById(UserId.create(userId));
    expect(user).not.toBeNull();
    expect(user!.notificationOptIn).toBe(true);
    expect(user!.marketingOptIn).toBe(false);
  });

  it('persists User.updatePreferences() output and rehydrates it identically', async () => {
    if (!dbAvailable) {
      return;
    }

    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        firstName: 'Repo',
        lastName: 'Test',
        email: `${TEST_PREFIX}${randomUUID()}@example.com`,
        passwordHash: 'argon2id$test',
        phone: null,
        language: 'en',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });

    const user = await userRepository.findById(UserId.create(userId));
    const at = new Date();
    const updated = user!.updatePreferences({ notificationOptIn: false, marketingOptIn: true }, at);
    await userRepository.save(updated);

    const rehydrated = await userRepository.findById(UserId.create(userId));
    expect(rehydrated).not.toBeNull();
    expect(rehydrated!.notificationOptIn).toBe(false);
    expect(rehydrated!.marketingOptIn).toBe(true);
    // Profile/credential/session state must survive an unrelated preferences
    // write untouched - proves updatePreferences()/save() never widen their
    // blast radius beyond the two opt-in fields.
    expect(rehydrated!.firstName).toBe('Repo');
    expect(rehydrated!.language).toBe('en');
    expect(rehydrated!.passwordHash.value).toBe('argon2id$test');
    expect(rehydrated!.sessionVersion).toBe(1);
  });
});
