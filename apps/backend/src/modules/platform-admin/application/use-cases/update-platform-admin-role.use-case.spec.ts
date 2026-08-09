import { UpdatePlatformAdminRoleUseCase } from './update-platform-admin-role.use-case';
import {
  PlatformAdminAuthContext,
  PlatformAdminListPage,
  PlatformAdminRecord,
  PlatformAdminRepository,
} from '../../domain/repositories/platform-admin.repository';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';
import { PlatformAdminNotFoundException } from '../../domain/exceptions/platform-admin-not-found.exception';
import { CannotModifyOwnPlatformAdminAccountException } from '../../domain/exceptions/cannot-modify-own-platform-admin-account.exception';
import { PlatformAdminRoleChangedEvent } from '../../domain/events/platform-admin.events';
import { RegistrationPolicy } from '@modules/authentication/domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import {
  CollectingEventPublisher,
  FixedClock,
  InMemoryUserRepository,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

class FakePlatformAdminRepository implements PlatformAdminRepository {
  readonly rows = new Map<string, PlatformAdminRecord>();
  readonly updateRoleCalls: Array<{ id: string; role: PlatformAdminRole; at: Date }> = [];

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
  async updateRole(id: string, role: PlatformAdminRole, at: Date): Promise<void> {
    this.updateRoleCalls.push({ id, role, at });
    const existing = this.rows.get(id);
    if (existing) {
      this.rows.set(id, { ...existing, role });
    }
  }
  async revoke(): Promise<void> {
    throw new Error('Not needed by this suite.');
  }
  async reactivate(): Promise<void> {
    throw new Error('Not needed by this suite.');
  }
}

describe('UpdatePlatformAdminRoleUseCase', () => {
  const now = new Date('2026-08-06T12:00:00.000Z');
  const actingAdminUserId = '11111111-1111-4111-8111-111111111111';
  const actingAdminPlatformAdminId = '22222222-2222-4222-8222-222222222222';
  const targetPlatformAdminId = '33333333-3333-4333-8333-333333333333';
  const targetUserId = '44444444-4444-4444-8444-444444444444';

  function build() {
    const platformAdminRepository = new FakePlatformAdminRepository();
    const userRepository = new InMemoryUserRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new UpdatePlatformAdminRoleUseCase(
      platformAdminRepository,
      userRepository,
      new FixedClock(now),
      new SequentialIdGenerator(['eeeeeeee-1111-4111-8111-111111111111']),
      eventPublisher,
    );
    return { useCase, platformAdminRepository, userRepository, eventPublisher };
  }

  async function seedTargetUser(userRepository: InMemoryUserRepository): Promise<void> {
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
  }

  it('updates the role and publishes PlatformAdminRoleChangedEvent with the previous role', async () => {
    const { useCase, platformAdminRepository, userRepository, eventPublisher } = build();
    await seedTargetUser(userRepository);
    platformAdminRepository.seed({
      id: targetPlatformAdminId,
      userId: targetUserId,
      role: PlatformAdminRole.PlatformSupport,
      createdAt: now,
      revokedAt: null,
    });

    const result = await useCase.execute({
      platformAdminId: targetPlatformAdminId,
      role: PlatformAdminRole.PlatformAdmin,
      actorId: actingAdminUserId,
    });

    expect(result.role).toBe(PlatformAdminRole.PlatformAdmin);
    expect(result.email).toBe('target-admin@tavla.internal');
    expect(platformAdminRepository.updateRoleCalls).toEqual([
      { id: targetPlatformAdminId, role: PlatformAdminRole.PlatformAdmin, at: now },
    ]);
    const event = eventPublisher.events[0] as PlatformAdminRoleChangedEvent;
    expect(event).toBeInstanceOf(PlatformAdminRoleChangedEvent);
    expect(event.payload).toEqual({
      platformAdminId: targetPlatformAdminId,
      role: PlatformAdminRole.PlatformAdmin,
      previousRole: PlatformAdminRole.PlatformSupport,
      actorId: actingAdminUserId,
    });
  });

  it('rejects a PlatformAdmin changing their own role (self-lockout prevention)', async () => {
    const { useCase, platformAdminRepository } = build();
    platformAdminRepository.seed({
      id: actingAdminPlatformAdminId,
      userId: actingAdminUserId,
      role: PlatformAdminRole.PlatformAdmin,
      createdAt: now,
      revokedAt: null,
    });

    await expect(
      useCase.execute({
        platformAdminId: actingAdminPlatformAdminId,
        role: PlatformAdminRole.PlatformSupport,
        actorId: actingAdminUserId,
      }),
    ).rejects.toThrow(CannotModifyOwnPlatformAdminAccountException);
  });

  it('rejects an unknown target (IDOR-safe)', async () => {
    const { useCase } = build();

    await expect(
      useCase.execute({
        platformAdminId: targetPlatformAdminId,
        role: PlatformAdminRole.PlatformAdmin,
        actorId: actingAdminUserId,
      }),
    ).rejects.toThrow(PlatformAdminNotFoundException);
  });
});
