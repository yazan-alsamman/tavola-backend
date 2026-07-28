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
  TableMergedEvent,
  TableMovedEvent,
  TableSplitEvent,
  TableStatusChangedEvent,
  TableUpdatedEvent,
} from '@modules/tables/domain/events/table.events';
import {
  ReservationApprovedEvent,
  ReservationCancelledEvent,
  ReservationCompletedEvent,
  ReservationCreatedEvent,
  ReservationExpiredEvent,
  ReservationNoShowEvent,
  ReservationRejectedEvent,
  ReservationRescheduledEvent,
  ReservationReminderDueEvent,
  ReservationReminderSentEvent,
  GuestLateArrivalNotifiedEvent,
  TableReadyNotifiedEvent,
} from '@modules/reservations/domain/events/reservation.events';
import {
  WaitlistEntryCancelledEvent,
  WaitlistEntryCreatedEvent,
  WaitlistEntryExpiredEvent,
  WaitlistEntryNotifiedEvent,
  WaitlistEntryPromotedEvent,
} from '@modules/waitlist/domain/events/waitlist.events';
import { NotificationCreatedEvent } from '@modules/notifications/domain/events/notification.events';
import {
  ReviewCreatedEvent,
  ReviewDeletedEvent,
  RestaurantRepliedToReviewEvent,
} from '@modules/reviews/domain/events/review.events';
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

    if (event instanceof TableStatusChangedEvent) {
      return {
        ...base,
        actorId: event.payload.actorId,
        actorType: 'User',
        action: 'table.status_changed',
        targetType: 'Table',
        targetId: event.payload.tableId,
        ipAddress: null,
      };
    }

    if (event instanceof TableMovedEvent) {
      return {
        ...base,
        actorId: event.payload.actorId,
        actorType: 'User',
        action: 'table.moved',
        targetType: 'Table',
        targetId: event.payload.tableId,
        ipAddress: null,
      };
    }

    if (event instanceof TableMergedEvent) {
      return {
        ...base,
        actorId: event.payload.actorId,
        // ADR-026 decision #16: Employee -> actorType Employee/Employee.id;
        // OrganizationMember Owner/Admin -> existing TableMoved/
        // TableStatusChanged convention (actorType User/userId). Recovered
        // from the request-scoped TenantContext, same mechanism already
        // used by ReservationCancelledEvent/ReservationRescheduledEvent for
        // an identically actor-ambiguous payload id.
        actorType: this.tenantContextService.getActorType() === 'Employee' ? 'Employee' : 'User',
        action: 'table.merged',
        targetType: 'Table',
        targetId: event.payload.primaryTableId,
        ipAddress: null,
      };
    }

    if (event instanceof TableSplitEvent) {
      return {
        ...base,
        actorId: event.payload.actorId,
        actorType: this.tenantContextService.getActorType() === 'Employee' ? 'Employee' : 'User',
        action: 'table.split',
        targetType: 'Table',
        targetId: event.payload.primaryTableId,
        ipAddress: null,
      };
    }

    if (event instanceof ReservationCreatedEvent) {
      return {
        ...base,
        actorId: event.payload.createdBy,
        // Phase 7.5: three-way attribution - userId set -> User;
        // userId null but createdBy set -> Employee (Phone/WalkIn/manual
        // Waitlist promotion); both null -> System (automatic Waitlist
        // promotion, source: WaitlistConversion).
        actorType:
          event.payload.userId !== null
            ? 'User'
            : event.payload.createdBy !== null
              ? 'Employee'
              : 'System',
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

    if (event instanceof ReservationCancelledEvent) {
      return {
        ...base,
        actorId: event.payload.cancelledBy,
        // Phase 8 audit-hygiene fix (EVENTS.md Phase 8 note, 2026-07-24):
        // `cancelledBy` is ambiguously a User's userId or an Employee's
        // employeeId (Cancel is reachable by both -
        // `assertActorCanModifyReservation`) - recovered from the same
        // request-scoped TenantContext the acting guard already populated,
        // rather than widening this already-frozen Phase 7.3 event payload.
        actorType: this.tenantContextService.getActorType() === 'Employee' ? 'Employee' : 'User',
        action: 'reservation.cancelled',
        targetType: 'Reservation',
        targetId: event.payload.reservationId,
        ipAddress: null,
      };
    }

    if (event instanceof ReservationRescheduledEvent) {
      return {
        ...base,
        actorId: event.payload.rescheduledBy,
        actorType: this.tenantContextService.getActorType() === 'Employee' ? 'Employee' : 'User',
        action: 'reservation.rescheduled',
        targetType: 'Reservation',
        targetId: event.payload.reservationId,
        ipAddress: null,
      };
    }

    if (event instanceof ReservationCompletedEvent) {
      return {
        ...base,
        actorId: event.payload.completedBy,
        actorType: 'Employee',
        action: 'reservation.completed',
        targetType: 'Reservation',
        targetId: event.payload.reservationId,
        ipAddress: null,
      };
    }

    if (event instanceof ReservationNoShowEvent) {
      return {
        ...base,
        actorId: event.payload.markedBy,
        actorType: 'Employee',
        action: 'reservation.no_show',
        targetType: 'Reservation',
        targetId: event.payload.reservationId,
        ipAddress: null,
      };
    }

    if (event instanceof ReservationExpiredEvent) {
      return {
        ...base,
        actorId: null,
        actorType: 'System',
        action: 'reservation.expired',
        targetType: 'Reservation',
        targetId: event.payload.reservationId,
        ipAddress: null,
      };
    }

    if (event instanceof ReservationReminderDueEvent) {
      return {
        ...base,
        actorId: null,
        actorType: 'System',
        action: 'reservation.reminder_due',
        targetType: 'Reservation',
        targetId: event.payload.reservationId,
        ipAddress: null,
      };
    }

    if (event instanceof ReservationReminderSentEvent) {
      return {
        ...base,
        actorId: null,
        actorType: 'System',
        action: 'reservation.reminder_sent',
        targetType: 'Reservation',
        targetId: event.payload.reservationId,
        ipAddress: null,
      };
    }

    if (event instanceof GuestLateArrivalNotifiedEvent) {
      return {
        ...base,
        actorId: null,
        actorType: 'System',
        action: 'reservation.late_arrival_notified',
        targetType: 'Reservation',
        targetId: event.payload.reservationId,
        ipAddress: null,
      };
    }

    if (event instanceof TableReadyNotifiedEvent) {
      return {
        ...base,
        actorId: event.payload.markedBy,
        actorType: 'Employee',
        action: 'reservation.table_ready_notified',
        targetType: 'Reservation',
        targetId: event.payload.reservationId,
        ipAddress: null,
      };
    }

    if (event instanceof WaitlistEntryCreatedEvent) {
      return {
        ...base,
        actorId: event.payload.createdBy,
        actorType: event.payload.userId !== null ? 'User' : 'Employee',
        action: 'waitlist.created',
        targetType: 'ReservationWaitlistEntry',
        targetId: event.payload.entryId,
        ipAddress: null,
      };
    }

    if (event instanceof WaitlistEntryPromotedEvent) {
      return {
        ...base,
        actorId: event.payload.promotedBy,
        actorType: event.payload.promotedBy ? 'Employee' : 'System',
        action: 'waitlist.promoted',
        targetType: 'ReservationWaitlistEntry',
        targetId: event.payload.entryId,
        ipAddress: null,
      };
    }

    if (event instanceof WaitlistEntryNotifiedEvent) {
      return {
        ...base,
        actorId: null,
        actorType: 'System',
        action: 'waitlist.notified',
        targetType: 'ReservationWaitlistEntry',
        targetId: event.payload.entryId,
        ipAddress: null,
      };
    }

    if (event instanceof WaitlistEntryExpiredEvent) {
      return {
        ...base,
        actorId: null,
        actorType: 'System',
        action: 'waitlist.expired',
        targetType: 'ReservationWaitlistEntry',
        targetId: event.payload.entryId,
        ipAddress: null,
      };
    }

    if (event instanceof WaitlistEntryCancelledEvent) {
      return {
        ...base,
        actorId: event.payload.cancelledBy,
        actorType: event.payload.cancelledByActorType,
        action: 'waitlist.cancelled',
        targetType: 'ReservationWaitlistEntry',
        targetId: event.payload.entryId,
        ipAddress: null,
      };
    }

    if (event instanceof NotificationCreatedEvent) {
      return {
        ...base,
        actorId: null,
        actorType: 'System',
        action: 'notification.created',
        targetType: 'Notification',
        targetId: event.payload.notificationId,
        ipAddress: null,
      };
    }

    if (event instanceof ReviewCreatedEvent) {
      return {
        ...base,
        actorId: event.payload.userId,
        actorType: 'User',
        action: 'review.created',
        targetType: 'Review',
        targetId: event.payload.reviewId,
        ipAddress: null,
      };
    }

    if (event instanceof ReviewDeletedEvent) {
      return {
        ...base,
        // Phase 10: `deletedBy` is always a User.id - either the owning
        // Customer or an Organization Owner/Admin (both attribute as
        // 'User', since `AuditActorType` has no `OrganizationMember`
        // variant and Owner/Admin actions have always logged as 'User'
        // platform-wide). Employees never delete Reviews in Phase 10.
        actorId: event.payload.deletedBy,
        actorType: 'User',
        action: 'review.deleted',
        targetType: 'Review',
        targetId: event.payload.reviewId,
        ipAddress: null,
      };
    }

    if (event instanceof RestaurantRepliedToReviewEvent) {
      return {
        ...base,
        actorId: event.payload.repliedByUserId,
        actorType: 'User',
        action: 'review.replied',
        targetType: 'Review',
        targetId: event.payload.reviewId,
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
