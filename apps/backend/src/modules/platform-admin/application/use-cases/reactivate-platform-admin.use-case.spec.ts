import { ReactivatePlatformAdminUseCase } from './reactivate-platform-admin.use-case';
import {
  PlatformAdminAuthContext,
  PlatformAdminListPage,
  PlatformAdminRecord,
  PlatformAdminRepository,
} from '../../domain/repositories/platform-admin.repository';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';
import { PlatformAdminNotFoundException } from '../../domain/exceptions/platform-admin-not-found.exception';
import { PlatformAdminAccountReactivatedEvent } from '../../domain/events/platform-admin.events';
import {
  CollectingEventPublisher,
  FixedClock,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

class FakePlatformAdminRepository implements PlatformAdminRepository {
  readonly rows = new Map<string, PlatformAdminRecord>();
  readonly reactivateCalls: string[] = [];

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
  async reactivate(id: string): Promise<void> {
    this.reactivateCalls.push(id);
    const existing = this.rows.get(id);
    if (existing) {
      this.rows.set(id, { ...existing, revokedAt: null });
    }
  }
}

/**
 * Phase 19.1 targeted remediation (idempotency finding from live verification):
 * a repeated Reactivate call on an already-active account used to
 * unconditionally call `repository.reactivate()` and republish
 * `PlatformAdminAccountReactivatedEvent` - since `AuditingEventPublisher`
 * writes one `audit_logs` row per `publish()` call (see its own doc comment),
 * asserting `eventPublisher.events.length` here is equivalent to asserting
 * the audit row count without needing a second, duplicate test against that
 * shared decorator.
 *
 * RBAC coverage (PlatformSupport cannot call this endpoint) is intentionally
 * not duplicated here - this fix only changes the use case's internal
 * idempotency guard, not the controller's
 * `@RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)` decorator or
 * `PlatformAdminRoleGuard`/`PlatformAdminGuard` themselves, and those are
 * already exercised generically (independent of which mutation route they
 * guard) in `platform-admin-role.guard.spec.ts` and `platform-admin.guard.spec.ts`.
 *
 * Concurrency: no new compare-and-set/locking test was added. The guard here
 * (`existing.revokedAt === null` read, then an unconditional
 * `UPDATE ... SET revokedAt = NULL` write) has the exact same read-then-write
 * race window as every sibling lifecycle transition in this codebase
 * (`PlatformAdminSuspendRestaurantUseCase`, `PlatformAdminReactivateOrganizationUseCase`,
 * etc. - none of which use row-level CAS or optimistic locking either). Two
 * concurrent Reactivate requests could both observe `revokedAt !== null` and
 * both write/publish once each - an existing, accepted, codebase-wide
 * property of this architecture, not something this fix introduces or is
 * newly responsible for closing. See PHASE 19.1 TARGETED REMEDIATION REPORT
 * §5 for the full analysis.
 */
describe('ReactivatePlatformAdminUseCase', () => {
  const now = new Date('2026-08-09T12:00:00.000Z');
  const actingAdminUserId = '11111111-1111-4111-8111-111111111111';
  const targetPlatformAdminId = '33333333-3333-4333-8333-333333333333';
  const targetUserId = '44444444-4444-4444-8444-444444444444';

  function build() {
    const platformAdminRepository = new FakePlatformAdminRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new ReactivatePlatformAdminUseCase(
      platformAdminRepository,
      new FixedClock(now),
      new SequentialIdGenerator([
        'eeeeeeee-1111-4111-8111-111111111111',
        'eeeeeeee-2222-4222-8222-222222222222',
      ]),
      eventPublisher,
    );
    return { useCase, platformAdminRepository, eventPublisher };
  }

  function seedRevoked(repo: FakePlatformAdminRepository): void {
    repo.seed({
      id: targetPlatformAdminId,
      userId: targetUserId,
      role: PlatformAdminRole.PlatformSupport,
      createdAt: now,
      revokedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
  }

  function seedActive(repo: FakePlatformAdminRepository): void {
    repo.seed({
      id: targetPlatformAdminId,
      userId: targetUserId,
      role: PlatformAdminRole.PlatformSupport,
      createdAt: now,
      revokedAt: null,
    });
  }

  it('reactivates a revoked account: persists the transition and publishes the event exactly once', async () => {
    const { useCase, platformAdminRepository, eventPublisher } = build();
    seedRevoked(platformAdminRepository);

    await useCase.execute({ platformAdminId: targetPlatformAdminId, actorId: actingAdminUserId });

    expect(platformAdminRepository.reactivateCalls).toEqual([targetPlatformAdminId]);
    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as PlatformAdminAccountReactivatedEvent;
    expect(event).toBeInstanceOf(PlatformAdminAccountReactivatedEvent);
    expect(event.payload.platformAdminId).toBe(targetPlatformAdminId);
    expect(event.payload.actorId).toBe(actingAdminUserId);
  });

  it('is a no-op on an already-active account: no repository write, no event, no audit row', async () => {
    const { useCase, platformAdminRepository, eventPublisher } = build();
    seedActive(platformAdminRepository);

    await expect(
      useCase.execute({ platformAdminId: targetPlatformAdminId, actorId: actingAdminUserId }),
    ).resolves.toBeUndefined();

    expect(platformAdminRepository.reactivateCalls).toEqual([]);
    expect(eventPublisher.events).toHaveLength(0);
  });

  it('reactivate called twice: first call transitions, second call is a no-op — exactly one event/audit total', async () => {
    const { useCase, platformAdminRepository, eventPublisher } = build();
    seedRevoked(platformAdminRepository);

    await useCase.execute({ platformAdminId: targetPlatformAdminId, actorId: actingAdminUserId });
    await useCase.execute({ platformAdminId: targetPlatformAdminId, actorId: actingAdminUserId });

    expect(platformAdminRepository.reactivateCalls).toEqual([targetPlatformAdminId]);
    expect(eventPublisher.events).toHaveLength(1);
  });

  it('rejects an unknown target (IDOR-safe, unchanged by this fix)', async () => {
    const { useCase } = build();

    await expect(
      useCase.execute({ platformAdminId: targetPlatformAdminId, actorId: actingAdminUserId }),
    ).rejects.toThrow(PlatformAdminNotFoundException);
  });
});
