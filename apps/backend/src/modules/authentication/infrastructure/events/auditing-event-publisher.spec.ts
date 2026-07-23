import { AuditLogEntry, AuditLogWriterPort } from '@shared/application/ports/audit-log-writer.port';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import {
  AccountLockedEvent,
  EmailVerifiedEvent,
  PasswordChangedEvent,
  PasswordResetCompletedEvent,
  PasswordResetRequestedEvent,
  SessionFamilyRevokedEvent,
  SessionRefreshedEvent,
  SessionRevokedEvent,
  TokenFamilyCompromisedEvent,
  TokenReplayDetectedEvent,
  UserLoggedInEvent,
  UserLoggedOutEvent,
  UserRegisteredEvent,
} from '../../domain/events/authentication.events';
import { DomainEvent } from '@shared/domain/base/domain-event.base';
import {
  RestaurantActivatedEvent,
  RestaurantCreatedEvent,
  RestaurantDeletedEvent,
  RestaurantSuspendedEvent,
  RestaurantUpdatedEvent,
} from '@modules/restaurants/domain/events/restaurant.events';
import {
  ReservationApprovedEvent,
  ReservationRejectedEvent,
} from '@modules/reservations/domain/events/reservation.events';
import { AuditingEventPublisher } from './auditing-event-publisher';
import { LoggingEventPublisher } from './logging-event-publisher';

class RecordingAuditLogWriter implements AuditLogWriterPort {
  readonly entries: AuditLogEntry[] = [];

  async record(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

class NoopLoggingEventPublisher extends LoggingEventPublisher {
  publishCalls: DomainEvent[] = [];

  constructor() {
    super({ log: () => undefined } as never);
  }

  async publish(event: DomainEvent): Promise<void> {
    this.publishCalls.push(event);
  }
}

class UnknownFutureEvent extends DomainEvent {
  public readonly eventName = 'SomeFutureEvent';
  public readonly payload: { userId: string };

  constructor(
    eventId: string,
    payload: { userId: string },
    occurredAt: Date,
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

class UnknownFutureEventWithoutUserId extends DomainEvent {
  public readonly eventName = 'SomeOtherFutureEvent';
  public readonly payload: Record<string, never> = {};

  constructor(eventId: string, occurredAt: Date) {
    super(eventId, occurredAt);
    this.seal();
  }
}

describe('AuditingEventPublisher', () => {
  const now = new Date('2026-07-12T10:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const tokenFamilyId = '33333333-3333-4333-8333-333333333333';

  function createPublisher(organizationId: string | null = null) {
    const inner = new NoopLoggingEventPublisher();
    const auditLogWriter = new RecordingAuditLogWriter();
    const tenantContextService = {
      getOrganizationId: () => organizationId,
    } as unknown as TenantContextService;
    const publisher = new AuditingEventPublisher(inner, auditLogWriter, tenantContextService);
    return { publisher, inner, auditLogWriter };
  }

  it('still delegates to the inner LoggingEventPublisher unchanged', async () => {
    const { publisher, inner } = createPublisher();
    const event = new UserRegisteredEvent(
      'event-1',
      { userId, email: 'a@example.com' },
      now,
      'corr-1',
    );

    await publisher.publish(event);

    expect(inner.publishCalls).toEqual([event]);
  });

  it('maps UserRegisteredEvent to auth.register.success', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    await publisher.publish(
      new UserRegisteredEvent('event-1', { userId, email: 'a@example.com' }, now, 'corr-1'),
    );

    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.register.success',
      actorId: userId,
      actorType: 'User',
      targetType: 'User',
      targetId: userId,
      correlationId: 'corr-1',
      organizationId: null,
    });
  });

  it('maps EmailVerifiedEvent to auth.verify_email.success', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    await publisher.publish(new EmailVerifiedEvent('event-1', { userId }, now));

    expect(auditLogWriter.entries[0].action).toBe('auth.verify_email.success');
  });

  it('maps AccountLockedEvent to auth.account.locked (Phase 2.19 - was a direct audit write until now)', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    const lockedUntil = new Date('2026-07-12T10:30:00.000Z');
    await publisher.publish(
      new AccountLockedEvent('event-1', { userId, lockedUntil, failedAttempts: 5 }, now),
    );

    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.account.locked',
      actorId: userId,
      targetType: 'User',
      targetId: userId,
    });
  });

  it('maps UserLoggedInEvent to auth.login.success with session target and IP', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    await publisher.publish(
      new UserLoggedInEvent(
        'event-1',
        { userId, sessionId, tokenFamilyId, ipAddress: '203.0.113.5' },
        now,
      ),
    );

    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.login.success',
      actorId: userId,
      targetType: 'Session',
      targetId: sessionId,
      ipAddress: '203.0.113.5',
    });
  });

  it('maps UserLoggedOutEvent scope "current" to auth.logout.success', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    await publisher.publish(
      new UserLoggedOutEvent('event-1', { userId, sessionId, scope: 'current' }, now),
    );

    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.logout.success',
      targetType: 'Session',
      targetId: sessionId,
    });
  });

  it('maps UserLoggedOutEvent scope "all" to auth.logout_all.success, targeting the user', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    await publisher.publish(new UserLoggedOutEvent('event-1', { userId, scope: 'all' }, now));

    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.logout_all.success',
      targetType: 'User',
      targetId: userId,
    });
  });

  it('maps SessionRevokedEvent to auth.session.revoked', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    await publisher.publish(
      new SessionRevokedEvent('event-1', { userId, sessionId, reason: 'logout' }, now),
    );

    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.session.revoked',
      targetType: 'Session',
      targetId: sessionId,
    });
  });

  it('maps SessionRefreshedEvent to auth.refresh.success', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    await publisher.publish(
      new SessionRefreshedEvent('event-1', { userId, sessionId, tokenFamilyId }, now),
    );

    expect(auditLogWriter.entries[0].action).toBe('auth.refresh.success');
  });

  it('maps TokenReplayDetectedEvent to auth.refresh.replay_detected', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    await publisher.publish(
      new TokenReplayDetectedEvent(
        'event-1',
        { userId, sessionId, tokenFamilyId, ipAddress: '203.0.113.9' },
        now,
      ),
    );

    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.refresh.replay_detected',
      ipAddress: '203.0.113.9',
    });
  });

  it('maps SessionFamilyRevokedEvent to auth.session_family.revoked targeting the TokenFamily', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    await publisher.publish(
      new SessionFamilyRevokedEvent('event-1', { userId, tokenFamilyId, reason: 'reuse' }, now),
    );

    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.session_family.revoked',
      targetType: 'TokenFamily',
      targetId: tokenFamilyId,
    });
  });

  it('maps TokenFamilyCompromisedEvent to auth.token_family.compromised', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    await publisher.publish(
      new TokenFamilyCompromisedEvent('event-1', { userId, tokenFamilyId }, now),
    );

    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.token_family.compromised',
      targetType: 'TokenFamily',
      targetId: tokenFamilyId,
    });
  });

  it('maps PasswordChangedEvent to auth.password_change.success', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    await publisher.publish(new PasswordChangedEvent('event-1', { userId }, now));
    expect(auditLogWriter.entries[0].action).toBe('auth.password_change.success');
  });

  it('maps PasswordResetRequestedEvent to auth.forgot_password.requested', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    await publisher.publish(new PasswordResetRequestedEvent('event-1', { userId }, now));
    expect(auditLogWriter.entries[0].action).toBe('auth.forgot_password.requested');
  });

  it('maps PasswordResetCompletedEvent to auth.password_reset.success', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    await publisher.publish(new PasswordResetCompletedEvent('event-1', { userId }, now));
    expect(auditLogWriter.entries[0].action).toBe('auth.password_reset.success');
  });

  it('falls back to a generic auth.<eventName> action for an unmapped future event', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    await publisher.publish(new UnknownFutureEvent('event-1', { userId }, now));

    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.SomeFutureEvent',
      actorId: userId,
      targetType: 'User',
      targetId: userId,
    });
  });

  it('falls back to a null actorId/targetType when the unmapped event carries no userId', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    await publisher.publish(new UnknownFutureEventWithoutUserId('event-1', now));

    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.SomeOtherFutureEvent',
      actorId: null,
      targetType: null,
      targetId: null,
    });
  });

  it('defaults ipAddress to null when UserLoggedInEvent carries none', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    await publisher.publish(
      new UserLoggedInEvent('event-1', { userId, sessionId, tokenFamilyId }, now),
    );

    expect(auditLogWriter.entries[0].ipAddress).toBeNull();
  });

  it('defaults ipAddress to null when TokenReplayDetectedEvent carries none', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    await publisher.publish(
      new TokenReplayDetectedEvent('event-1', { userId, sessionId, tokenFamilyId }, now),
    );

    expect(auditLogWriter.entries[0].ipAddress).toBeNull();
  });

  it('reads organizationId from TenantContextService when bound', async () => {
    const { publisher, auditLogWriter } = createPublisher('org-42');
    await publisher.publish(new PasswordChangedEvent('event-1', { userId }, now));

    expect(auditLogWriter.entries[0].organizationId).toBe('org-42');
  });

  it('publishAll delegates to publish for every event, preserving order', async () => {
    const { publisher, auditLogWriter } = createPublisher();
    const eventA = new PasswordChangedEvent('event-1', { userId }, now);
    const eventB = new PasswordResetRequestedEvent('event-2', { userId }, now);

    await publisher.publishAll([eventA, eventB]);

    expect(auditLogWriter.entries.map((entry) => entry.action)).toEqual([
      'auth.password_change.success',
      'auth.forgot_password.requested',
    ]);
  });

  describe('Restaurant events (Phase 4.1)', () => {
    const restaurantId = '44444444-4444-4444-8444-444444444444';
    const organizationId = '55555555-5555-4555-8555-555555555555';

    function restaurantPayload() {
      return { restaurantId, organizationId, actorId: userId };
    }

    it('maps RestaurantCreatedEvent to restaurant.created', async () => {
      const { publisher, auditLogWriter } = createPublisher(organizationId);
      await publisher.publish(
        new RestaurantCreatedEvent('event-1', restaurantPayload(), now, 'corr-1'),
      );

      expect(auditLogWriter.entries[0]).toMatchObject({
        action: 'restaurant.created',
        actorId: userId,
        actorType: 'User',
        targetType: 'Restaurant',
        targetId: restaurantId,
        organizationId,
        correlationId: 'corr-1',
      });
    });

    it('maps RestaurantUpdatedEvent to restaurant.updated', async () => {
      const { publisher, auditLogWriter } = createPublisher(organizationId);
      await publisher.publish(new RestaurantUpdatedEvent('event-1', restaurantPayload(), now));

      expect(auditLogWriter.entries[0]).toMatchObject({
        action: 'restaurant.updated',
        actorId: userId,
        targetType: 'Restaurant',
        targetId: restaurantId,
      });
    });

    it('maps RestaurantDeletedEvent to restaurant.deleted', async () => {
      const { publisher, auditLogWriter } = createPublisher(organizationId);
      await publisher.publish(new RestaurantDeletedEvent('event-1', restaurantPayload(), now));

      expect(auditLogWriter.entries[0]).toMatchObject({
        action: 'restaurant.deleted',
        actorId: userId,
        targetType: 'Restaurant',
        targetId: restaurantId,
      });
    });

    it('maps RestaurantActivatedEvent to restaurant.activated', async () => {
      const { publisher, auditLogWriter } = createPublisher(organizationId);
      await publisher.publish(new RestaurantActivatedEvent('event-1', restaurantPayload(), now));

      expect(auditLogWriter.entries[0]).toMatchObject({
        action: 'restaurant.activated',
        actorId: userId,
        targetType: 'Restaurant',
        targetId: restaurantId,
      });
    });

    it('maps RestaurantSuspendedEvent to restaurant.suspended', async () => {
      const { publisher, auditLogWriter } = createPublisher(organizationId);
      await publisher.publish(new RestaurantSuspendedEvent('event-1', restaurantPayload(), now));

      expect(auditLogWriter.entries[0]).toMatchObject({
        action: 'restaurant.suspended',
        actorId: userId,
        targetType: 'Restaurant',
        targetId: restaurantId,
      });
    });
  });

  describe('Reservation events (Phase 7.2)', () => {
    const reservationId = '66666666-6666-4666-8666-666666666666';
    const restaurantId = '77777777-7777-4777-8777-777777777777';
    const branchId = '88888888-8888-4888-8888-888888888888';
    const tableId = '99999999-9999-4999-8999-999999999999';
    const employeeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    it('maps ReservationApprovedEvent (manual) to reservation.approved with actorType Employee', async () => {
      const { publisher, auditLogWriter } = createPublisher();
      await publisher.publish(
        new ReservationApprovedEvent(
          'event-1',
          {
            reservationId,
            restaurantId,
            branchId,
            tableId,
            approvedBy: employeeId,
            automatic: false,
          },
          now,
          'corr-1',
        ),
      );

      expect(auditLogWriter.entries[0]).toMatchObject({
        action: 'reservation.approved',
        actorId: employeeId,
        actorType: 'Employee',
        targetType: 'Reservation',
        targetId: reservationId,
        correlationId: 'corr-1',
      });
    });

    it('maps ReservationApprovedEvent (auto-approval) to reservation.approved with actorType System', async () => {
      const { publisher, auditLogWriter } = createPublisher();
      await publisher.publish(
        new ReservationApprovedEvent(
          'event-1',
          { reservationId, restaurantId, branchId, tableId, approvedBy: null, automatic: true },
          now,
        ),
      );

      expect(auditLogWriter.entries[0]).toMatchObject({
        action: 'reservation.approved',
        actorId: null,
        actorType: 'System',
        targetType: 'Reservation',
        targetId: reservationId,
      });
    });

    it('maps ReservationRejectedEvent (manual) to reservation.rejected with actorType Employee', async () => {
      const { publisher, auditLogWriter } = createPublisher();
      await publisher.publish(
        new ReservationRejectedEvent(
          'event-1',
          {
            reservationId,
            restaurantId,
            branchId,
            tableId,
            rejectedBy: employeeId,
            automatic: false,
          },
          now,
        ),
      );

      expect(auditLogWriter.entries[0]).toMatchObject({
        action: 'reservation.rejected',
        actorId: employeeId,
        actorType: 'Employee',
        targetType: 'Reservation',
        targetId: reservationId,
      });
    });

    it('maps ReservationRejectedEvent (automatic) to reservation.rejected with actorType System', async () => {
      const { publisher, auditLogWriter } = createPublisher();
      await publisher.publish(
        new ReservationRejectedEvent(
          'event-1',
          { reservationId, restaurantId, branchId, tableId, rejectedBy: null, automatic: true },
          now,
        ),
      );

      expect(auditLogWriter.entries[0]).toMatchObject({
        action: 'reservation.rejected',
        actorId: null,
        actorType: 'System',
        targetType: 'Reservation',
        targetId: reservationId,
      });
    });
  });
});
