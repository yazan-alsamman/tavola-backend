import { PrismaClient, UserStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaUserRepository } from '@modules/authentication/infrastructure/persistence/prisma-user.repository';
import { PhoneAlreadyExistsException } from '@modules/authentication/domain/exceptions/phone-already-exists.exception';
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

  it('is race-safe when two different users concurrently claim the same phone: exactly one save() succeeds', async () => {
    if (!dbAvailable) {
      return;
    }

    const targetPhone = '+963900000077';
    const userIdA = randomUUID();
    const userIdB = randomUUID();
    await prisma.user.createMany({
      data: [
        {
          id: userIdA,
          firstName: 'Race',
          lastName: 'A',
          email: `${TEST_PREFIX}${randomUUID()}@example.com`,
          passwordHash: 'argon2id$test',
          phone: null,
          language: 'en',
          preferredCurrency: null,
          status: UserStatus.Active,
          emailVerified: true,
        },
        {
          id: userIdB,
          firstName: 'Race',
          lastName: 'B',
          email: `${TEST_PREFIX}${randomUUID()}@example.com`,
          passwordHash: 'argon2id$test',
          phone: null,
          language: 'en',
          preferredCurrency: null,
          status: UserStatus.Active,
          emailVerified: true,
        },
      ],
    });

    const userA = await userRepository.findById(UserId.create(userIdA));
    const userB = await userRepository.findById(UserId.create(userIdB));
    const at = new Date();
    const updatedA = userA!.updateProfile(
      {
        firstName: 'Race',
        lastName: 'A',
        phone: targetPhone,
        language: 'en',
        preferredCurrency: null,
      },
      at,
    );
    const updatedB = userB!.updateProfile(
      {
        firstName: 'Race',
        lastName: 'B',
        phone: targetPhone,
        language: 'en',
        preferredCurrency: null,
      },
      at,
    );

    const results = await Promise.allSettled([
      userRepository.save(updatedA),
      userRepository.save(updatedB),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      PhoneAlreadyExistsException,
    );

    const winnerCount = await prisma.user.count({ where: { phone: targetPhone } });
    expect(winnerCount).toBe(1);
  });
});
