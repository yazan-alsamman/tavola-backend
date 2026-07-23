import { Inject, Injectable } from '@nestjs/common';
import { DomainEvent } from '@shared/domain/base/domain-event.base';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import {
  AuditLogEntry,
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
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
import {
  RestaurantActivatedEvent,
  RestaurantCreatedEvent,
  RestaurantDeletedEvent,
  RestaurantSuspendedEvent,
  RestaurantUpdatedEvent,
} from '@modules/restaurants/domain/events/restaurant.events';
import {
  BranchCreatedEvent,
  BranchDeletedEvent,
  BranchUpdatedEvent,
} from '@modules/branches/domain/events/branch.events';
import {
  TableCreatedEvent,
  TableDeletedEvent,
  TableUpdatedEvent,
} from '@modules/tables/domain/events/table.events';
import {
  ReservationApprovedEvent,
  ReservationCreatedEvent,
  ReservationRejectedEvent,
} from '@modules/reservations/domain/events/reservation.events';
import { LoggingEventPublisher } from './logging-event-publisher';

/**
 * Decorates `LoggingEventPublisher` (structured logging is unchanged, still
 * delegated to it) with EVENTS.md's rule: "All security events write to
 * AuditLogs with `action` matching event name." Bound to the `EVENT_PUBLISHER`
 * token in place of `LoggingEventPublisher` directly - every existing use
 * case's `eventPublisher.publish(...)` call is unchanged, so this phase adds
 * zero lines to `LoginUseCase`/`RefreshSessionUseCase`/etc.'s success paths.
 *
 * Called after the originating transaction has already committed in every
 * existing use case (each calls `eventPublisher.publish` only after
 * `unitOfWork.execute` resolves) - satisfies EVENTS.md's "publish events
 * only after successful database transactions" without this class needing
 * to know anything about transactions itself.
 *
 * `organizationId` comes from `TenantContextService.getOrganizationId()`
 * (never client input) - populated for authenticated Employee/OrganizationMember
 * actions where `TenantContextInterceptor` already bound it before this
 * publish call runs; safely `null` for pre-authentication actions (login,
 * registration, forgot-password) where no such context exists yet.
 */
@Injectable()
export class AuditingEventPublisher implements EventPublisherPort {
  constructor(
    private readonly inner: LoggingEventPublisher,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
    private readonly tenantContextService: TenantContextService,
  ) {}

  async publish(event: DomainEvent): Promise<void> {
    await this.inner.publish(event);
    await this.auditLogWriter.record(this.toAuditEntry(event));
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  private toAuditEntry(event: DomainEvent): AuditLogEntry {
    const organizationId = this.tenantContextService.getOrganizationId();
    const base = {
      organizationId,
      correlationId: event.correlationId ?? null,
      occurredAt: event.occurredAt,
    };

    if (event instanceof UserRegisteredEvent) {
      return {
        ...base,
        actorId: event.payload.userId,
        actorType: 'User',
        action: 'auth.register.success',
        targetType: 'User',
        targetId: event.payload.userId,
        ipAddress: null,
      };
    }

    if (event instanceof EmailVerifiedEvent) {
      return {
        ...base,
        actorId: event.payload.userId,
        actorType: 'User',
        action: 'auth.verify_email.success',
        targetType: 'User',
        targetId: event.payload.userId,
        ipAddress: null,
      };
    }

    if (event instanceof AccountLockedEvent) {
      return {
        ...base,
        actorId: event.payload.userId,
        actorType: 'User',
        action: 'auth.account.locked',
        targetType: 'User',
        targetId: event.payload.userId,
        ipAddress: null,
      };
    }

    if (event instanceof UserLoggedInEvent) {
      return {
        ...base,
        actorId: event.payload.userId,
        actorType: 'User',
        action: 'auth.login.success',
        targetType: 'Session',
        targetId: event.payload.sessionId,
        ipAddress: event.payload.ipAddress ?? null,
      };
    }

    if (event instanceof UserLoggedOutEvent) {
      const sessionId = event.payload.sessionId ?? null;
      return {
        ...base,
        actorId: event.payload.userId,
        actorType: 'User',
        action: event.payload.scope === 'all' ? 'auth.logout_all.success' : 'auth.logout.success',
        targetType: sessionId ? 'Session' : 'User',
        targetId: sessionId ?? event.payload.userId,
        ipAddress: null,
      };
    }

    if (event instanceof SessionRevokedEvent) {
      return {
        ...base,
        actorId: event.payload.userId,
        actorType: 'User',
        action: 'auth.session.revoked',
        targetType: 'Session',
        targetId: event.payload.sessionId,
        ipAddress: null,
      };
    }

    if (event instanceof SessionRefreshedEvent) {
      return {
        ...base,
        actorId: event.payload.userId,
        actorType: 'User',
        action: 'auth.refresh.success',
        targetType: 'Session',
        targetId: event.payload.sessionId,
        ipAddress: null,
      };
    }

    if (event instanceof TokenReplayDetectedEvent) {
      return {
        ...base,
        actorId: event.payload.userId,
        actorType: 'User',
        action: 'auth.refresh.replay_detected',
        targetType: 'Session',
        targetId: event.payload.sessionId,
        ipAddress: event.payload.ipAddress ?? null,
      };
    }

    if (event instanceof SessionFamilyRevokedEvent) {
      return {
        ...base,
        actorId: event.payload.userId,
        actorType: 'User',
        action: 'auth.session_family.revoked',
        targetType: 'TokenFamily',
        targetId: event.payload.tokenFamilyId,
        ipAddress: null,
      };
    }

    if (event instanceof TokenFamilyCompromisedEvent) {
      return {
        ...base,
        actorId: event.payload.userId,
        actorType: 'User',
        action: 'auth.token_family.compromised',
        targetType: 'TokenFamily',
        targetId: event.payload.tokenFamilyId,
        ipAddress: null,
      };
    }

    if (event instanceof PasswordChangedEvent) {
      return {
        ...base,
        actorId: event.payload.userId,
        actorType: 'User',
        action: 'auth.password_change.success',
        targetType: 'User',
        targetId: event.payload.userId,
        ipAddress: null,
      };
    }

    if (event instanceof PasswordResetRequestedEvent) {
      return {
        ...base,
        actorId: event.payload.userId,
        actorType: 'User',
        action: 'auth.forgot_password.requested',
        targetType: 'User',
        targetId: event.payload.userId,
        ipAddress: null,
      };
    }

    if (event instanceof PasswordResetCompletedEvent) {
      return {
        ...base,
        actorId: event.payload.userId,
        actorType: 'User',
        action: 'auth.password_reset.success',
        targetType: 'User',
        targetId: event.payload.userId,
        ipAddress: null,
      };
    }

    if (event instanceof RestaurantCreatedEvent) {
      return {
        ...base,
        actorId: event.payload.actorId,
        actorType: 'User',
        action: 'restaurant.created',
        targetType: 'Restaurant',
        targetId: event.payload.restaurantId,
        ipAddress: null,
      };
    }

    if (event instanceof RestaurantUpdatedEvent) {
      return {
        ...base,
        actorId: event.payload.actorId,
        actorType: 'User',
        action: 'restaurant.updated',
        targetType: 'Restaurant',
        targetId: event.payload.restaurantId,
        ipAddress: null,
      };
    }

    if (event instanceof RestaurantDeletedEvent) {
      return {
        ...base,
        actorId: event.payload.actorId,
        actorType: 'User',
        action: 'restaurant.deleted',
        targetType: 'Restaurant',
        targetId: event.payload.restaurantId,
        ipAddress: null,
      };
    }

    if (event instanceof RestaurantActivatedEvent) {
      return {
        ...base,
        actorId: event.payload.actorId,
        actorType: 'User',
        action: 'restaurant.activated',
        targetType: 'Restaurant',
        targetId: event.payload.restaurantId,
        ipAddress: null,
      };
    }

    if (event instanceof RestaurantSuspendedEvent) {
      return {
        ...base,
        actorId: event.payload.actorId,
        actorType: 'User',
        action: 'restaurant.suspended',
        targetType: 'Restaurant',
        targetId: event.payload.restaurantId,
        ipAddress: null,
      };
    }

    if (event instanceof BranchCreatedEvent) {
      return {
        ...base,
        actorId: event.payload.actorId,
        actorType: 'User',
        action: 'branch.created',
        targetType: 'Branch',
        targetId: event.payload.branchId,
        ipAddress: null,
      };
    }

    if (event instanceof BranchUpdatedEvent) {
      return {
        ...base,
        actorId: event.payload.actorId,
        actorType: 'User',
        action: 'branch.updated',
        targetType: 'Branch',
        targetId: event.payload.branchId,
        ipAddress: null,
      };
    }

    if (event instanceof BranchDeletedEvent) {
      return {
        ...base,
        actorId: event.payload.actorId,
        actorType: 'User',
        action: 'branch.deleted',
        targetType: 'Branch',
        targetId: event.payload.branchId,
        ipAddress: null,
      };
    }

    if (event instanceof TableCreatedEvent) {
      return {
        ...base,
        actorId: event.payload.actorId,
        actorType: 'User',
        action: 'table.created',
        targetType: 'Table',
        targetId: event.payload.tableId,
        ipAddress: null,
      };
    }

    if (event instanceof TableUpdatedEvent) {
      return {
        ...base,
        actorId: event.payload.actorId,
        actorType: 'User',
        action: 'table.updated',
        targetType: 'Table',
        targetId: event.payload.tableId,
        ipAddress: null,
      };
    }

    if (event instanceof TableDeletedEvent) {
      return {
        ...base,
        actorId: event.payload.actorId,
        actorType: 'User',
        action: 'table.deleted',
        targetType: 'Table',
        targetId: event.payload.tableId,
        ipAddress: null,
      };
    }

    if (event instanceof ReservationCreatedEvent) {
      return {
        ...base,
        actorId: event.payload.userId,
        actorType: 'User',
        action: 'reservation.created',
        targetType: 'Reservation',
        targetId: event.payload.reservationId,
        ipAddress: null,
      };
    }

    if (event instanceof ReservationApprovedEvent) {
      return {
        ...base,
        actorId: event.payload.approvedBy,
        actorType: event.payload.approvedBy ? 'Employee' : 'System',
        action: 'reservation.approved',
        targetType: 'Reservation',
        targetId: event.payload.reservationId,
        ipAddress: null,
      };
    }

    if (event instanceof ReservationRejectedEvent) {
      return {
        ...base,
        actorId: event.payload.rejectedBy,
        actorType: event.payload.rejectedBy ? 'Employee' : 'System',
        action: 'reservation.rejected',
        targetType: 'Reservation',
        targetId: event.payload.reservationId,
        ipAddress: null,
      };
    }

    // Forward-compatible fallback for any future event this file hasn't been
    // updated for yet (e.g. Phase 2.19 wiring up an already-documented but
    // currently-unpublished security event) - still produces an audit row
    // rather than silently dropping coverage, using whatever `userId` the
    // event's payload happens to carry.
    const payload = event as unknown as { payload?: { userId?: unknown } };
    const fallbackActorId =
      typeof payload.payload?.userId === 'string' ? payload.payload.userId : null;
    return {
      ...base,
      actorId: fallbackActorId,
      actorType: 'User',
      action: `auth.${event.eventName}`,
      targetType: fallbackActorId ? 'User' : null,
      targetId: fallbackActorId,
      ipAddress: null,
    };
  }
}
