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

/** ADR-034 §4 (new, Phase 19.4). Never cascades to Restaurant.status/deletedAt - no cascade, ever (§5). */
export class OrganizationDeletedEvent extends DomainEvent {
  public readonly eventName = 'OrganizationDeleted';
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

/** ADR-034 §4 (new, Phase 19.4) - closes the same standing "no restore capability" gap ADR-034 §3 already closed for Restaurant. */
export class OrganizationRestoredEvent extends DomainEvent {
  public readonly eventName = 'OrganizationRestored';
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

/**
 * Phase 19.7 (Organization self-service member management) - documented
 * since Phase 0 (`EVENTS.md`), gains its first real producer here
 * (`ChangeOrganizationMemberRoleUseCase`, Owner/Admin self-service).
 */
export class OrganizationMemberRoleChangedEvent extends DomainEvent {
  public readonly eventName = 'OrganizationMemberRoleChanged';
  public readonly payload: OrganizationEventPayload & {
    memberId: string;
    targetUserId: string;
    previousRole: string;
    newRole: string;
  };

  constructor(
    eventId: string,
    payload: OrganizationEventPayload & {
      memberId: string;
      targetUserId: string;
      previousRole: string;
      newRole: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

/**
 * Phase 19.7 (Organization self-service member management) - documented
 * since Phase 0 (`EVENTS.md`), gains its first real producer here
 * (`RemoveOrganizationMemberUseCase`, Owner/Admin self-service).
 */
export class OrganizationMemberRemovedEvent extends DomainEvent {
  public readonly eventName = 'OrganizationMemberRemoved';
  public readonly payload: OrganizationEventPayload & {
    memberId: string;
    targetUserId: string;
  };

  constructor(
    eventId: string,
    payload: OrganizationEventPayload & { memberId: string; targetUserId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

/**
 * Phase 19.8 (Owner Invite, ADR-036) - documented since Phase 0
 * (`EVENTS.md`/`DOMAIN_MODEL.md`), gains its first real producer here
 * (`IssueOrganizationInvitationUseCase`). Means exactly "an invitation was
 * issued" - it is never published again when the invitation is later
 * accepted (see `OrganizationInvitationAcceptedEvent` below for that
 * transition, per the Owner Invite decision's Section 14).
 */
export class OrganizationMemberInvitedEvent extends DomainEvent {
  public readonly eventName = 'OrganizationMemberInvited';
  public readonly payload: OrganizationEventPayload & {
    invitationId: string;
    email: string;
    role: string;
  };

  constructor(
    eventId: string,
    payload: OrganizationEventPayload & { invitationId: string; email: string; role: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

/** Phase 19.8 (Owner Invite, ADR-036) - a Pending invitation was explicitly revoked (including the automatic revoke-old half of resend semantics). */
export class OrganizationInvitationRevokedEvent extends DomainEvent {
  public readonly eventName = 'OrganizationInvitationRevoked';
  public readonly payload: OrganizationEventPayload & {
    invitationId: string;
    email: string;
  };

  constructor(
    eventId: string,
    payload: OrganizationEventPayload & { invitationId: string; email: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

/**
 * Phase 19.8 (Owner Invite, ADR-036) - the invitation was accepted and the
 * resulting `OrganizationMember` was created/reactivated. `actorId` is the
 * new member's own `userId` (self-service acceptance, always self-actuated -
 * there is no PlatformAdmin/other-actor producer of this event).
 * `accountCreated` distinguishes the Section 8 (new User + OrganizationMember,
 * atomic) branch from the Section 7 (existing User, OrganizationMember only)
 * branch.
 */
export class OrganizationInvitationAcceptedEvent extends DomainEvent {
  public readonly eventName = 'OrganizationInvitationAccepted';
  public readonly payload: OrganizationEventPayload & {
    invitationId: string;
    memberId: string;
    targetUserId: string;
    role: string;
    accountCreated: boolean;
  };

  constructor(
    eventId: string,
    payload: OrganizationEventPayload & {
      invitationId: string;
      memberId: string;
      targetUserId: string;
      role: string;
      accountCreated: boolean;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}
