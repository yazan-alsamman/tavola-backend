import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaUserRepository } from '@modules/authentication/infrastructure/persistence/prisma-user.repository';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const prisma = new PrismaClient();
const TEST_PREFIX = 'user-profile-repo-';

describe('User profile round-trip via PrismaUserRepository (integration)', () => {
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

  it('persists User.updateProfile() output and rehydrates it identically', async () => {
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
        preferredCurrency: null,
        status: UserStatus.Active,
        emailVerified: true,
      },
    });

    const user = await userRepository.findById(UserId.create(userId));
    expect(user).not.toBeNull();

    const at = new Date();
    const updated = user!.updateProfile(
      {
        firstName: 'Updated',
        lastName: 'Person',
        phone: '+963900000001',
        language: 'ar',
        preferredCurrency: 'USD',
      },
      at,
    );
    await userRepository.save(updated);

    const rehydrated = await userRepository.findById(UserId.create(userId));
    expect(rehydrated).not.toBeNull();
    expect(rehydrated!.firstName).toBe('Updated');
    expect(rehydrated!.lastName).toBe('Person');
    expect(rehydrated!.phone).toBe('+963900000001');
    expect(rehydrated!.language).toBe('ar');
    expect(rehydrated!.preferredCurrency).toBe('USD');
    // Credentials/session state must survive an unrelated profile write
    // untouched - proves updateProfile()/save() never widen their blast
    // radius to fields outside the profile allowlist.
    expect(rehydrated!.passwordHash.value).toBe('argon2id$test');
    expect(rehydrated!.sessionVersion).toBe(1);
  });

  it('clears phone and preferredCurrency back to null on request', async () => {
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
        phone: '+963900000002',
        language: 'en',
        preferredCurrency: 'EUR',
        status: UserStatus.Active,
        emailVerified: true,
      },
    });

    const user = await userRepository.findById(UserId.create(userId));
    const updated = user!.updateProfile(
      { firstName: 'Repo', lastName: 'Test', phone: null, language: 'en', preferredCurrency: null },
      new Date(),
    );
    await userRepository.save(updated);

    const rehydrated = await userRepository.findById(UserId.create(userId));
    expect(rehydrated!.phone).toBeNull();
    expect(rehydrated!.preferredCurrency).toBeNull();
  });
});
