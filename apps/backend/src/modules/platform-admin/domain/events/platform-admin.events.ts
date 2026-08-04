import { DomainEvent } from '@shared/domain/base/domain-event.base';
import { PlatformAdminRole } from '../enums/platform-admin.enums';

export interface PlatformAdminAccountEventPayload {
  platformAdminId: string;
  role: PlatformAdminRole;
  actorId: string;
}

/** ADR-034 §10 — finally makes `PlatformAdmin.revokedAt` reachable via an API, delivering FR-19.1. */
export class PlatformAdminAccountCreatedEvent extends DomainEvent {
  public readonly eventName = 'PlatformAdminAccountCreated';
  public readonly payload: PlatformAdminAccountEventPayload;

  constructor(
    eventId: string,
    payload: PlatformAdminAccountEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

/** ADR-034 §10. Terminal (revocation), mirroring Employee's soft-delete-only shape - see `deactivate-platform-admin.use-case.ts`. */
export class PlatformAdminAccountRevokedEvent extends DomainEvent {
  public readonly eventName = 'PlatformAdminAccountRevoked';
  public readonly payload: PlatformAdminAccountEventPayload;

  constructor(
    eventId: string,
    payload: PlatformAdminAccountEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

/**
 * Phase 19.1 implementation addition, not in ADR-034's literal event list -
 * symmetric with `PlatformAdminAccountRevoked` and required because this
 * phase also implements Reactivate (see platform-admin.module's own
 * Engineering Report for the scoping rationale). Documented in EVENTS.md
 * alongside the two ADR-034 events above.
 */
export class PlatformAdminAccountReactivatedEvent extends DomainEvent {
  public readonly eventName = 'PlatformAdminAccountReactivated';
  public readonly payload: PlatformAdminAccountEventPayload;

  constructor(
    eventId: string,
    payload: PlatformAdminAccountEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

/** Phase 19.1 implementation addition (Update Platform Admin = role change, the only mutable field on this table). */
export class PlatformAdminRoleChangedEvent extends DomainEvent {
  public readonly eventName = 'PlatformAdminRoleChanged';
  public readonly payload: PlatformAdminAccountEventPayload & { previousRole: PlatformAdminRole };

  constructor(
    eventId: string,
    payload: PlatformAdminAccountEventPayload & { previousRole: PlatformAdminRole },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}
