import { RegisterOrganizationOwnerUseCase } from '@modules/authentication/application/use-cases/register-organization-owner.use-case';
import { UserStatus } from '@modules/authentication/domain/enums/authentication.enums';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import {
  CollectingEventPublisher,
  FakeOpaqueTokenService,
  FakePasswordHasher,
  FixedClock,
  InMemoryEmailVerificationRepository,
  InMemoryOrganizationMemberRepository,
  InMemoryOrganizationRepository,
  InMemorySystemConfiguration,
  InMemoryUserConsentRepository,
  InMemoryUserRepository,
  RecordingTenantContextPort,
  SequentialIdGenerator,
  UuidGenerator,
} from './support/in-memory-registration.dependencies';

class TransactionalUnitOfWork implements UnitOfWorkPort {
  private committed = false;

  constructor(
    private readonly userRepository: InMemoryUserRepository,
    private readonly organizationRepository: InMemoryOrganizationRepository,
    private readonly organizationMemberRepository: InMemoryOrganizationMemberRepository,
    private readonly userConsentRepository: InMemoryUserConsentRepository,
    private readonly emailVerificationRepository: InMemoryEmailVerificationRepository,
  ) {}

  async execute<T>(work: () => Promise<T>): Promise<T> {
    const userSnapshot = this.userRepository.snapshot();
    const organizationSnapshot = this.organizationRepository.snapshot();
    const memberSnapshot = this.organizationMemberRepository.snapshot();
    const consentSnapshot = [...this.userConsentRepository.consents];
    const tokenSnapshot = [...this.emailVerificationRepository.tokens];

    try {
      const result = await work();
      this.committed = true;
      return result;
    } catch (error) {
      this.userRepository.restore(userSnapshot);
      this.organizationRepository.restore(organizationSnapshot);
      this.organizationMemberRepository.restore(memberSnapshot);
      this.userConsentRepository.restore(consentSnapshot);
      this.emailVerificationRepository.restore(tokenSnapshot);
      throw error;
    }
  }

  wasCommitted(): boolean {
    return this.committed;
  }
}

describe('RegisterOrganizationOwnerUseCase (integration)', () => {
  const fixedNow = new Date('2026-07-07T15:00:00.000Z');

  it('persists user, organization, owner membership, consents, and verification token atomically', async () => {
    const userRepository = new InMemoryUserRepository();
    const organizationRepository = new InMemoryOrganizationRepository();
    const organizationMemberRepository = new InMemoryOrganizationMemberRepository();
    const emailVerificationRepository = new InMemoryEmailVerificationRepository();
    const userConsentRepository = new InMemoryUserConsentRepository();
    const eventPublisher = new CollectingEventPublisher();
    const unitOfWork = new TransactionalUnitOfWork(
      userRepository,
      organizationRepository,
      organizationMemberRepository,
      userConsentRepository,
      emailVerificationRepository,
    );

    const useCase = new RegisterOrganizationOwnerUseCase(
      userRepository,
      organizationRepository,
      organizationMemberRepository,
      emailVerificationRepository,
      userConsentRepository,
      new FakePasswordHasher(),
      new FakeOpaqueTokenService(),
      unitOfWork,
      eventPublisher,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      new InMemorySystemConfiguration({ emailVerificationTokenTtlHours: 48 }),
      new RecordingTenantContextPort(),
    );

    const result = await useCase.execute({
      email: 'integration-owner@example.com',
      password: 'Integration1Pass!',
      firstName: 'Integration',
      lastName: 'Owner',
      organizationName: 'Integration Kitchen',
      consents: {
        termsOfService: true,
        privacyPolicy: true,
        marketing: true,
      },
      ipAddress: '198.51.100.42',
    });

    expect(result.status).toBe(UserStatus.Pending);
    expect(result.organizationSlug).toBe('integration-kitchen');
    expect(userRepository.snapshot()).toHaveLength(1);
    expect(organizationRepository.snapshot()).toHaveLength(1);
    expect(organizationMemberRepository.snapshot()).toHaveLength(1);
    expect(organizationMemberRepository.snapshot()[0].role).toBe(OrganizationMemberRole.Owner);
    expect(userConsentRepository.consents).toHaveLength(3);
    expect(emailVerificationRepository.tokens).toHaveLength(1);
    expect(eventPublisher.events).toHaveLength(1);
    expect(unitOfWork.wasCommitted()).toBe(true);
  });

  it('rolls back all writes when persistence fails inside the transaction', async () => {
    const userRepository = new InMemoryUserRepository();
    const organizationRepository = new InMemoryOrganizationRepository();
    const organizationMemberRepository = new InMemoryOrganizationMemberRepository();
    const emailVerificationRepository = new InMemoryEmailVerificationRepository();
    const userConsentRepository = new InMemoryUserConsentRepository();

    const failingConsentRepository = {
      saveMany: async () => {
        throw new Error('Simulated persistence failure');
      },
    };

    const unitOfWork = new TransactionalUnitOfWork(
      userRepository,
      organizationRepository,
      organizationMemberRepository,
      userConsentRepository,
      emailVerificationRepository,
    );

    const useCase = new RegisterOrganizationOwnerUseCase(
      userRepository,
      organizationRepository,
      organizationMemberRepository,
      emailVerificationRepository,
      failingConsentRepository,
      new FakePasswordHasher(),
      new FakeOpaqueTokenService(),
      unitOfWork,
      new CollectingEventPublisher(),
      new FixedClock(fixedNow),
      new SequentialIdGenerator([
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        '10101010-1010-4101-8101-101010101010',
      ]),
      new InMemorySystemConfiguration(),
      new RecordingTenantContextPort(),
    );

    await expect(
      useCase.execute({
        email: 'rollback@example.com',
        password: 'RollbackPass1!',
        firstName: 'Roll',
        lastName: 'Back',
        organizationName: 'Rollback Org',
        consents: { termsOfService: true, privacyPolicy: true },
        ipAddress: '127.0.0.1',
      }),
    ).rejects.toThrow('Simulated persistence failure');

    expect(userRepository.snapshot()).toHaveLength(0);
    expect(organizationRepository.snapshot()).toHaveLength(0);
    expect(organizationMemberRepository.snapshot()).toHaveLength(0);
    expect(emailVerificationRepository.tokens).toHaveLength(0);
  });
});
