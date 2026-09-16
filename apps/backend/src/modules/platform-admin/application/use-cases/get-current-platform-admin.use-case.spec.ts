import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { RegistrationPolicy } from '@modules/authentication/domain/services/registration-policy';
import { GetCurrentPlatformAdminUseCase } from './get-current-platform-admin.use-case';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';
import { PlatformAdminNotFoundException } from '../../domain/exceptions/platform-admin-not-found.exception';
import {
  PlatformAdminAuthContext,
  PlatformAdminListPage,
  PlatformAdminRecord,
  PlatformAdminRepository,
} from '../../domain/repositories/platform-admin.repository';
import { InMemoryUserRepository } from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('GetCurrentPlatformAdminUseCase', () => {
  const now = new Date('2026-09-15T10:00:00.000Z');
  const adminUserId = '11111111-1111-4111-8111-111111111111';
  const platformAdminId = '33333333-3333-4333-8333-333333333333';

  class FakePlatformAdminRepository implements PlatformAdminRepository {
    constructor(private readonly record: PlatformAdminRecord | null) {}
    async findActiveAdminContext(): Promise<PlatformAdminAuthContext | null> {
      return this.record ? { role: this.record.role } : null;
    }
    async findById(): Promise<PlatformAdminRecord | null> {
      return this.record;
    }
    async findByUserId(): Promise<PlatformAdminRecord | null> {
      return this.record;
    }
    list(): Promise<PlatformAdminListPage> {
      throw new Error('Not needed by this suite.');
    }
    create(): Promise<void> {
      throw new Error('Not needed by this suite.');
    }
    updateRole(): Promise<void> {
      throw new Error('Not needed by this suite.');
    }
    revoke(): Promise<void> {
      throw new Error('Not needed by this suite.');
    }
    reactivate(): Promise<void> {
      throw new Error('Not needed by this suite.');
    }
  }

  function activeRecord(overrides?: Partial<PlatformAdminRecord>): PlatformAdminRecord {
    return {
      id: platformAdminId,
      userId: adminUserId,
      role: PlatformAdminRole.PlatformSupport,
      createdAt: now,
      revokedAt: null,
      ...overrides,
    };
  }

  async function seedUser(): Promise<InMemoryUserRepository> {
    const userRepository = new InMemoryUserRepository();
    const user = RegistrationPolicy.createPendingUser({
      id: adminUserId,
      email: Email.create('admin@tavla.internal'),
      passwordHash: PasswordHash.create('argon2id$fake$hash'),
      firstName: 'Farid',
      lastName: 'Haddad',
      phone: null,
      language: 'en',
      at: now,
    }).verifyEmail(now);
    await userRepository.save(user);
    return userRepository;
  }

  it('returns the identity joined with the live PlatformAdmin grant', async () => {
    const userRepository = await seedUser();
    const useCase = new GetCurrentPlatformAdminUseCase(
      new FakePlatformAdminRepository(activeRecord()),
      userRepository,
    );

    const result = await useCase.execute({ platformAdminUserId: adminUserId });

    expect(result).toMatchObject({
      userId: adminUserId,
      platformAdminId,
      email: 'admin@tavla.internal',
      firstName: 'Farid',
      lastName: 'Haddad',
      // Sourced from the live row, not echoed from a JWT claim - so a
      // demotion shows up on the next call rather than at next login.
      role: PlatformAdminRole.PlatformSupport,
      platformAdminCreatedAt: now,
    });
  });

  it('never exposes the password hash or session/permissions versions', async () => {
    const userRepository = await seedUser();
    const useCase = new GetCurrentPlatformAdminUseCase(
      new FakePlatformAdminRepository(activeRecord()),
      userRepository,
    );

    const result = await useCase.execute({ platformAdminUserId: adminUserId });

    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('sessionVersion');
    expect(result).not.toHaveProperty('permissionsVersion');
  });

  it('throws when the grant was revoked between the guard check and this read', async () => {
    const userRepository = await seedUser();
    const useCase = new GetCurrentPlatformAdminUseCase(
      new FakePlatformAdminRepository(activeRecord({ revokedAt: now })),
      userRepository,
    );

    await expect(useCase.execute({ platformAdminUserId: adminUserId })).rejects.toBeInstanceOf(
      PlatformAdminNotFoundException,
    );
  });

  it('throws when no PlatformAdmin grant exists', async () => {
    const userRepository = await seedUser();
    const useCase = new GetCurrentPlatformAdminUseCase(
      new FakePlatformAdminRepository(null),
      userRepository,
    );

    await expect(useCase.execute({ platformAdminUserId: adminUserId })).rejects.toBeInstanceOf(
      PlatformAdminNotFoundException,
    );
  });

  it('throws when the underlying User row is gone', async () => {
    const useCase = new GetCurrentPlatformAdminUseCase(
      new FakePlatformAdminRepository(activeRecord()),
      new InMemoryUserRepository(),
    );

    await expect(useCase.execute({ platformAdminUserId: adminUserId })).rejects.toBeInstanceOf(
      PlatformAdminNotFoundException,
    );
  });

  it('reads the User by the id it was given', async () => {
    const userRepository = await seedUser();
    const spy = jest.spyOn(userRepository, 'findById');
    const useCase = new GetCurrentPlatformAdminUseCase(
      new FakePlatformAdminRepository(activeRecord()),
      userRepository,
    );

    await useCase.execute({ platformAdminUserId: adminUserId });

    expect(spy).toHaveBeenCalledWith(UserId.create(adminUserId));
  });
});
