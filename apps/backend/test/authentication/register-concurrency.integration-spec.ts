import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { RegisterOrganizationOwnerUseCase } from '@modules/authentication/application/use-cases/register-organization-owner.use-case';
import { PrismaUserRepository } from '@modules/authentication/infrastructure/persistence/prisma-user.repository';
import { PrismaEmailVerificationRepository } from '@modules/authentication/infrastructure/persistence/prisma-user.repository';
import { PrismaSystemConfiguration } from '@modules/authentication/infrastructure/persistence/prisma-system-configuration';
import { PrismaUnitOfWork } from '@modules/authentication/infrastructure/persistence/prisma-unit-of-work';
import { PrismaUserConsentRepository } from '@modules/authentication/infrastructure/persistence/prisma-user-consent.repository';
import { PrismaOrganizationRepository } from '@modules/organizations/infrastructure/persistence/prisma-organization.repository';
import { PrismaOrganizationMemberRepository } from '@modules/organizations/infrastructure/persistence/prisma-organization-member.repository';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { Sha256OpaqueTokenService } from '@modules/authentication/infrastructure/security/sha256-opaque-token.service';
import { EmailAlreadyExistsException } from '@modules/authentication/domain/exceptions/email-already-exists.exception';
import { RegisterOrganizationOwnerCommand } from '@modules/authentication/application/dto/register-organization-owner.command';
import {
  CollectingEventPublisher,
  FixedClock,
  UuidGenerator,
  FakePasswordHasher,
} from './support/in-memory-registration.dependencies';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * CRITICAL BLOCKER #1 verification (Phase 2.12): proves that two concurrent
 * registrations for the same email can no longer both succeed now that
 * users.email carries a real database unique constraint (see migration
 * 20260710190000_add_users_email_unique_constraint) and
 * PrismaUserRepository.save translates the resulting P2002 violation into
 * EmailAlreadyExistsException. This is a genuine race against real
 * PostgreSQL — not a check-then-act simulation — since existsByEmail is no
 * longer consulted by RegisterOrganizationOwnerUseCase at all.
 */

const prisma = new PrismaClient();
const TEST_PREFIX = 'register-concurrency-';
const opaqueTokenService = new Sha256OpaqueTokenService();

describe('Registration concurrent duplicate-email race (integration)', () => {
  let dbAvailable = false;
  let userRepository: PrismaUserRepository;
  let emailVerificationRepository: PrismaEmailVerificationRepository;
  let systemConfiguration: PrismaSystemConfiguration;
  let unitOfWork: PrismaUnitOfWork;
  let userConsentRepository: PrismaUserConsentRepository;
  let organizationRepository: PrismaOrganizationRepository;
  let organizationMemberRepository: PrismaOrganizationMemberRepository;
  let tenantContextService: TenantContextService;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaUserRepository,
      PrismaEmailVerificationRepository,
      PrismaSystemConfiguration,
      PrismaUnitOfWork,
      PrismaUserConsentRepository,
      PrismaOrganizationRepository,
      PrismaOrganizationMemberRepository,
    ]);

    userRepository = moduleRef.get(PrismaUserRepository);
    emailVerificationRepository = moduleRef.get(PrismaEmailVerificationRepository);
    systemConfiguration = moduleRef.get(PrismaSystemConfiguration);
    unitOfWork = moduleRef.get(PrismaUnitOfWork);
    userConsentRepository = moduleRef.get(PrismaUserConsentRepository);
    organizationRepository = moduleRef.get(PrismaOrganizationRepository);
    organizationMemberRepository = moduleRef.get(PrismaOrganizationMemberRepository);
    tenantContextService = moduleRef.get(TenantContextService);
  });

  afterAll(async () => {
    if (!dbAvailable) {
      return;
    }

    await prisma.emailVerificationToken.deleteMany({
      where: { user: { email: { startsWith: TEST_PREFIX } } },
    });
    await prisma.userConsent.deleteMany({
      where: { user: { email: { startsWith: TEST_PREFIX } } },
    });
    await prisma.organizationMember.deleteMany({
      where: { user: { email: { startsWith: TEST_PREFIX } } },
    });
    await prisma.organization.deleteMany({
      where: { slug: { startsWith: TEST_PREFIX } },
    });
    await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await prisma.$disconnect();
  });

  function buildUseCase(): RegisterOrganizationOwnerUseCase {
    return new RegisterOrganizationOwnerUseCase(
      userRepository,
      organizationRepository,
      organizationMemberRepository,
      emailVerificationRepository,
      userConsentRepository,
      new FakePasswordHasher(),
      opaqueTokenService,
      unitOfWork,
      new CollectingEventPublisher(),
      new FixedClock(new Date()),
      new UuidGenerator(),
      systemConfiguration,
      tenantContextService,
    );
  }

  function buildCommand(email: string, organizationSlug: string): RegisterOrganizationOwnerCommand {
    return {
      email,
      password: 'ConcurrentPass1!',
      firstName: 'Race',
      lastName: 'Test',
      organizationName: `Race Org ${organizationSlug}`,
      organizationSlug,
      consents: { termsOfService: true, privacyPolicy: true },
      ipAddress: '127.0.0.1',
    };
  }

  it('allows exactly one of two concurrent registrations with the same email to succeed', async () => {
    if (!dbAvailable) return;

    const email = `${TEST_PREFIX}${randomUUID()}@example.com`;
    const slugA = `${TEST_PREFIX}a-${randomUUID()}`;
    const slugB = `${TEST_PREFIX}b-${randomUUID()}`;

    const results = await Promise.allSettled([
      buildUseCase().execute(buildCommand(email, slugA)),
      buildUseCase().execute(buildCommand(email, slugB)),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(EmailAlreadyExistsException);

    const userCount = await prisma.user.count({ where: { email } });
    expect(userCount).toBe(1);

    const organizationCount = await prisma.organization.count({
      where: { slug: { in: [slugA, slugB] } },
    });
    expect(organizationCount).toBe(1);
  });
});
