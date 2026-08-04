import { DomainEvent } from '@shared/domain/base/domain-event.base';

export interface OrganizationEventPayload {
  organizationId: string;
  actorId: string;
}

/** ADR-034 §4 - documented since Phase 0, gains its first real producer here (PlatformAdmin-authorized; never cascades to `Restaurant.status`, §5). */
export class OrganizationSuspendedEvent extends DomainEvent {
  public readonly eventName = 'OrganizationSuspended';
  public readonly payload: OrganizationEventPayload;

  constructor(
    eventId: string,
    payload: OrganizationEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

/** ADR-034 §4 (new). */
export class OrganizationReactivatedEvent extends DomainEvent {
  public readonly eventName = 'OrganizationReactivated';
  public readonly payload: OrganizationEventPayload;

  constructor(
    eventId: string,
    payload: OrganizationEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

/** ADR-034 §6 - documented since Phase 0, gains its first real producer here (narrow, PlatformAdmin-only emergency transfer). */
export class OrganizationOwnershipTransferredEvent extends DomainEvent {
  public readonly eventName = 'OrganizationOwnershipTransferred';
  public readonly payload: OrganizationEventPayload & {
    previousOwnerUserId: string;
    newOwnerUserId: string;
  };

  constructor(
    eventId: string,
    payload: OrganizationEventPayload & { previousOwnerUserId: string; newOwnerUserId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}
