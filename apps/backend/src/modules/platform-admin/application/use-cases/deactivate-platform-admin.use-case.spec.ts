import { DeactivatePlatformAdminUseCase } from './deactivate-platform-admin.use-case';
import {
  PlatformAdminAuthContext,
  PlatformAdminListPage,
  PlatformAdminRecord,
  PlatformAdminRepository,
} from '../../domain/repositories/platform-admin.repository';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';
import { PlatformAdminNotFoundException } from '../../domain/exceptions/platform-admin-not-found.exception';
import { CannotModifyOwnPlatformAdminAccountException } from '../../domain/exceptions/cannot-modify-own-platform-admin-account.exception';
import { PlatformAdminAccountRevokedEvent } from '../../domain/events/platform-admin.events';
import {
  CollectingEventPublisher,
  FixedClock,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

class FakePlatformAdminRepository implements PlatformAdminRepository {
  readonly rows = new Map<string, PlatformAdminRecord>();
  readonly revokedIds: string[] = [];

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
  async revoke(id: string): Promise<void> {
    this.revokedIds.push(id);
  }
  async reactivate(): Promise<void> {
    throw new Error('Not needed by this suite.');
  }
}

describe('DeactivatePlatformAdminUseCase', () => {
  const now = new Date('2026-08-04T12:00:00.000Z');
  const actingAdminUserId = '11111111-1111-4111-8111-111111111111';
  const actingAdminPlatformAdminId = '22222222-2222-4222-8222-222222222222';
  const targetPlatformAdminId = '33333333-3333-4333-8333-333333333333';
  const targetUserId = '44444444-4444-4444-8444-444444444444';

  function build() {
    const platformAdminRepository = new FakePlatformAdminRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new DeactivatePlatformAdminUseCase(
      platformAdminRepository,
      new FixedClock(now),
      new SequentialIdGenerator(['eeeeeeee-1111-4111-8111-111111111111']),
      eventPublisher,
    );
    return { useCase, platformAdminRepository, eventPublisher };
  }

  it('revokes the target account and publishes PlatformAdminAccountRevokedEvent', async () => {
    const { useCase, platformAdminRepository, eventPublisher } = build();
    platformAdminRepository.seed({
      id: targetPlatformAdminId,
      userId: targetUserId,
      role: PlatformAdminRole.PlatformSupport,
      createdAt: now,
      revokedAt: null,
    });

    await useCase.execute({ platformAdminId: targetPlatformAdminId, actorId: actingAdminUserId });

    expect(platformAdminRepository.revokedIds).toEqual([targetPlatformAdminId]);
    const event = eventPublisher.events[0] as PlatformAdminAccountRevokedEvent;
    expect(event).toBeInstanceOf(PlatformAdminAccountRevokedEvent);
    expect(event.payload.actorId).toBe(actingAdminUserId);
  });

  it('rejects an unknown target (IDOR-safe)', async () => {
    const { useCase } = build();

    await expect(
      useCase.execute({ platformAdminId: targetPlatformAdminId, actorId: actingAdminUserId }),
    ).rejects.toThrow(PlatformAdminNotFoundException);
  });

  it('rejects a PlatformAdmin deactivating their own account (self-lockout prevention)', async () => {
    const { useCase, platformAdminRepository } = build();
    platformAdminRepository.seed({
      id: actingAdminPlatformAdminId,
      userId: actingAdminUserId,
      role: PlatformAdminRole.PlatformAdmin,
      createdAt: now,
      revokedAt: null,
    });

    await expect(
      useCase.execute({ platformAdminId: actingAdminPlatformAdminId, actorId: actingAdminUserId }),
    ).rejects.toThrow(CannotModifyOwnPlatformAdminAccountException);
  });
});
