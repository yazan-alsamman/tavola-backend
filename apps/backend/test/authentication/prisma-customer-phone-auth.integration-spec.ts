import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaPendingCustomerRegistrationRepository } from '@modules/authentication/infrastructure/persistence/prisma-pending-customer-registration.repository';
import { PrismaUserRepository } from '@modules/authentication/infrastructure/persistence/prisma-user.repository';
import { CustomerRegistrationPolicy } from '@modules/authentication/domain/services/customer-registration.policy';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { Username } from '@shared/domain/value-objects/username.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { UsernameAlreadyExistsException } from '@modules/authentication/domain/exceptions/username-already-exists.exception';
import { PhoneAlreadyExistsException } from '@modules/authentication/domain/exceptions/phone-already-exists.exception';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const prisma = new PrismaClient();
const TEST_PREFIX = 'phone_auth_it_';

/**
 * ADR-022 (Phase 2.23): real-PostgreSQL verification of the two invariants
 * that cannot be safely proven with in-memory fakes alone - database-level
 * unique constraints and the repeated-START/upsert concurrency guarantee
 * (TESTING_STRATEGY.md: "migration behavior must be tested against real
 * PostgreSQL").
 */
describe('Customer phone-first persistence (integration)', () => {
  let pendingRepository: PrismaPendingCustomerRegistrationRepository;
  let userRepository: PrismaUserRepository;
  let dbAvailable = false;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaPendingCustomerRegistrationRepository,
      PrismaUserRepository,
    ]);

    pendingRepository = moduleRef.get(PrismaPendingCustomerRegistrationRepository);
    userRepository = moduleRef.get(PrismaUserRepository);
  });

  afterAll(async () => {
    if (!dbAvailable) {
      return;
    }
    await prisma.pendingCustomerRegistration.deleteMany({
      where: { username: { startsWith: TEST_PREFIX } },
    });
    await prisma.user.deleteMany({ where: { username: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  it('enforces canonical phone uniqueness at the database level on PendingCustomerRegistration', async () => {
    if (!dbAvailable) return;

    const phone = `+96391${randomUUID().replace(/\D/g, '').slice(0, 7)}`;
    const now = new Date();

    const first = await pendingRepository.upsertActive({
      username: `${TEST_PREFIX}user1`,
      phone,
      codeHash: 'hash1',
      codeExpiresAt: new Date(now.getTime() + 5 * 60_000),
      now,
    });

    // ADR-022 Decision #18: a second call for the SAME phone restarts the
    // same row (real DB upsert), never creates a second one.
    const second = await pendingRepository.upsertActive({
      username: `${TEST_PREFIX}user1-restarted`,
      phone,
      codeHash: 'hash2',
      codeExpiresAt: new Date(now.getTime() + 5 * 60_000),
      now,
    });

    expect(second.id).toBe(first.id);
    expect(second.username).toBe(`${TEST_PREFIX}user1-restarted`);
    expect(second.codeHash).toBe('hash2');
    expect(second.incorrectAttemptCount).toBe(0);

    const count = await prisma.pendingCustomerRegistration.count({ where: { phone } });
    expect(count).toBe(1);
  });

  it('rejects a username collision against a DIFFERENT phone`s active pending registration (real unique constraint)', async () => {
    if (!dbAvailable) return;

    const phoneA = `+96392${randomUUID().replace(/\D/g, '').slice(0, 7)}`;
    const phoneB = `+96393${randomUUID().replace(/\D/g, '').slice(0, 7)}`;
    const now = new Date();

    await pendingRepository.upsertActive({
      username: `${TEST_PREFIX}shared`,
      phone: phoneA,
      codeHash: 'hash1',
      codeExpiresAt: new Date(now.getTime() + 5 * 60_000),
      now,
    });

    await expect(
      pendingRepository.upsertActive({
        username: `${TEST_PREFIX}shared`,
        phone: phoneB,
        codeHash: 'hash2',
        codeExpiresAt: new Date(now.getTime() + 5 * 60_000),
        now,
      }),
    ).rejects.toThrow(UsernameAlreadyExistsException);
  });

  it('enforces canonical phone uniqueness on User at the database level, and equivalent formatting resolves to the same identity', async () => {
    if (!dbAvailable) return;

    const phone = PhoneNumber.create('SY', '0912340000');
    const user = CustomerRegistrationPolicy.createActiveCustomer({
      id: randomUUID(),
      username: Username.create(`${TEST_PREFIX}canonical`),
      phone,
      passwordHash: PasswordHash.create('argon2id$test'),
      at: new Date(),
    });
    await userRepository.save(user);

    // Same real number, entered without the leading trunk zero - must
    // resolve to the identical canonical E.164 identity and therefore
    // collide on the same unique constraint.
    const equivalentPhone = PhoneNumber.create('SY', '912340000');
    expect(equivalentPhone.value).toBe(phone.value);

    const duplicate = CustomerRegistrationPolicy.createActiveCustomer({
      id: randomUUID(),
      username: Username.create(`${TEST_PREFIX}canonical2`),
      phone: equivalentPhone,
      passwordHash: PasswordHash.create('argon2id$test'),
      at: new Date(),
    });

    await expect(userRepository.save(duplicate)).rejects.toThrow(PhoneAlreadyExistsException);
  });

  it('allows an Owner-shaped User (no phone/username) to coexist with Customer rows without constraint conflicts', async () => {
    if (!dbAvailable) return;

    const owner = await prisma.user.create({
      data: {
        id: randomUUID(),
        firstName: 'Owner',
        lastName: 'Test',
        email: `${TEST_PREFIX}owner@example.com`,
        phone: null,
        username: null,
        passwordHash: 'argon2id$test',
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });

    expect(owner.phone).toBeNull();
    expect(owner.username).toBeNull();

    await prisma.user.delete({ where: { id: owner.id } });
  });
});
