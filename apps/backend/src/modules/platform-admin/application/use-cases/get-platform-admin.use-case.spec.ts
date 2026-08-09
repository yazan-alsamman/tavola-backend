import { GetPlatformAdminUseCase } from './get-platform-admin.use-case';
import {
  PlatformAdminAuthContext,
  PlatformAdminListPage,
  PlatformAdminRecord,
  PlatformAdminRepository,
} from '../../domain/repositories/platform-admin.repository';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';
import { PlatformAdminNotFoundException } from '../../domain/exceptions/platform-admin-not-found.exception';
import { RegistrationPolicy } from '@modules/authentication/domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { InMemoryUserRepository } from '../../../../../test/authentication/support/in-memory-registration.dependencies';

class FakePlatformAdminRepository implements PlatformAdminRepository {
  readonly rows = new Map<string, PlatformAdminRecord>();

  seed(record: PlatformAdminRecord): void {
    this.rows.set(record.id, record);
  }
  async findActiveAdminContext(): Promise<PlatformAdminAuthContext | null> {
    throw new Error('Not needed by this suite.');
  }
  async findById(id: string): Promise<PlatformAdminRecord | null> {
    return this.rows.get(id) ?? null;
  }
  async findByUserId(): Promise<PlatformAdminRecord | null> {
    throw new Error('Not needed by this suite.');
  }
  async list(): Promise<PlatformAdminListPage> {
    throw new Error('Not needed by this suite.');
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

describe('GetPlatformAdminUseCase', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');
  const targetPlatformAdminId = '11111111-1111-4111-8111-111111111111';
  const targetUserId = '22222222-2222-4222-8222-222222222222';

  function build() {
    const platformAdminRepository = new FakePlatformAdminRepository();
    const userRepository = new InMemoryUserRepository();
    const useCase = new GetPlatformAdminUseCase(platformAdminRepository, userRepository);
    return { useCase, platformAdminRepository, userRepository };
  }

  it('returns the account enriched with its User email', async () => {
    const { useCase, platformAdminRepository, userRepository } = build();
    const user = RegistrationPolicy.createPendingUser({
      id: targetUserId,
      email: Email.create('target-admin@tavla.internal'),
      passwordHash: PasswordHash.create('argon2id$fake$hash'),
      firstName: 'Target',
      lastName: 'Admin',
      phone: null,
      language: 'en',
      at: now,
    }).verifyEmail(now);
    await userRepository.save(user);
    platformAdminRepository.seed({
      id: targetPlatformAdminId,
      userId: targetUserId,
      role: PlatformAdminRole.PlatformSupport,
      createdAt: now,
      revokedAt: null,
    });

    const result = await useCase.execute({ platformAdminId: targetPlatformAdminId });

    expect(result).toEqual({
      id: targetPlatformAdminId,
      userId: targetUserId,
      email: 'target-admin@tavla.internal',
      role: PlatformAdminRole.PlatformSupport,
      createdAt: now,
      revokedAt: null,
    });
  });

  it('rejects an unknown target (IDOR-safe)', async () => {
    const { useCase } = build();

    await expect(useCase.execute({ platformAdminId: targetPlatformAdminId })).rejects.toThrow(
      PlatformAdminNotFoundException,
    );
  });
});
