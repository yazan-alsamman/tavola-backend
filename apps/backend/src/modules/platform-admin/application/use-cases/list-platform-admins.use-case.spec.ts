import { ListPlatformAdminsUseCase } from './list-platform-admins.use-case';
import {
  PlatformAdminAuthContext,
  PlatformAdminListPage,
  PlatformAdminRecord,
  PlatformAdminRepository,
} from '../../domain/repositories/platform-admin.repository';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';
import { RegistrationPolicy } from '@modules/authentication/domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { InMemoryUserRepository } from '../../../../../test/authentication/support/in-memory-registration.dependencies';

class FakePlatformAdminRepository implements PlatformAdminRepository {
  rows: PlatformAdminRecord[] = [];
  total = 0;
  lastListArgs: { page: number; limit: number } | undefined;

  async findActiveAdminContext(): Promise<PlatformAdminAuthContext | null> {
    throw new Error('Not needed by this suite.');
  }
  async findById(): Promise<PlatformAdminRecord | null> {
    throw new Error('Not needed by this suite.');
  }
  async findByUserId(): Promise<PlatformAdminRecord | null> {
    throw new Error('Not needed by this suite.');
  }
  async list(page: number, limit: number): Promise<PlatformAdminListPage> {
    this.lastListArgs = { page, limit };
    return { items: this.rows, total: this.total };
  }
  async create(): Promise<void> {
    throw new Error('Not needed by this suite.');
  }
  async updateRole(): Promise<void> {
    throw new Error('Not needed by this suite.');
  }
  async revoke(): Promise<void> {
    throw new Error('Not needed by this suite.');
  }
  async reactivate(): Promise<void> {
    throw new Error('Not needed by this suite.');
  }
}

describe('ListPlatformAdminsUseCase', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');
  const firstAdminUserId = '11111111-1111-4111-8111-111111111111';
  const secondAdminUserId = '22222222-2222-4222-8222-222222222222';

  function build() {
    const platformAdminRepository = new FakePlatformAdminRepository();
    const userRepository = new InMemoryUserRepository();
    const useCase = new ListPlatformAdminsUseCase(platformAdminRepository, userRepository);
    return { useCase, platformAdminRepository, userRepository };
  }

  async function seedUser(
    userRepository: InMemoryUserRepository,
    id: string,
    email: string,
  ): Promise<void> {
    const user = RegistrationPolicy.createPendingUser({
      id,
      email: Email.create(email),
      passwordHash: PasswordHash.create('argon2id$fake$hash'),
      firstName: 'Admin',
      lastName: 'User',
      phone: null,
      language: 'en',
      at: now,
    }).verifyEmail(now);
    await userRepository.save(user);
  }

  it('enriches each page item with its matching User email and passes pagination through unchanged', async () => {
    const { useCase, platformAdminRepository, userRepository } = build();
    await seedUser(userRepository, firstAdminUserId, 'first@tavla.internal');
    await seedUser(userRepository, secondAdminUserId, 'second@tavla.internal');
    platformAdminRepository.rows = [
      {
        id: 'admin-1',
        userId: firstAdminUserId,
        role: PlatformAdminRole.PlatformAdmin,
        createdAt: now,
        revokedAt: null,
      },
      {
        id: 'admin-2',
        userId: secondAdminUserId,
        role: PlatformAdminRole.PlatformSupport,
        createdAt: now,
        revokedAt: null,
      },
    ];
    platformAdminRepository.total = 2;

    const result = await useCase.execute({ page: 2, limit: 10 });

    expect(platformAdminRepository.lastListArgs).toEqual({ page: 2, limit: 10 });
    expect(result.total).toBe(2);
    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
    expect(result.items).toEqual([
      expect.objectContaining({ id: 'admin-1', email: 'first@tavla.internal' }),
      expect.objectContaining({ id: 'admin-2', email: 'second@tavla.internal' }),
    ]);
  });

  it('returns a null email for a PlatformAdmin row whose User cannot be resolved', async () => {
    const { useCase, platformAdminRepository } = build();
    platformAdminRepository.rows = [
      {
        id: 'admin-orphan',
        userId: 'ffffffff-1111-4111-8111-111111111111',
        role: PlatformAdminRole.PlatformAdmin,
        createdAt: now,
        revokedAt: null,
      },
    ];
    platformAdminRepository.total = 1;

    const result = await useCase.execute({ page: 1, limit: 10 });

    expect(result.items[0]).toMatchObject({ id: 'admin-orphan', email: null });
  });

  it('returns an empty page unchanged', async () => {
    const { useCase } = build();

    const result = await useCase.execute({ page: 1, limit: 10 });

    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 10 });
  });
});
