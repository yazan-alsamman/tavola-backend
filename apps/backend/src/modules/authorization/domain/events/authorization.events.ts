import { DomainEvent } from '@shared/domain/base/domain-event.base';

export interface AuthorizationEventPayload {
  correlationId?: string;
}

export class RoleAssignedEvent extends DomainEvent {
  public readonly eventName = 'RoleAssigned';

  constructor(
    eventId: string,
    public readonly payload: AuthorizationEventPayload & {
      employeeId: string;
      roleId: string;
      assignedBy: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class PermissionGrantedEvent extends DomainEvent {
  public readonly eventName = 'PermissionGranted';

  constructor(
    eventId: string,
    public readonly payload: AuthorizationEventPayload & {
      employeeId: string;
      permissionId: string;
      grantedBy: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class PermissionRevokedEvent extends DomainEvent {
  public readonly eventName = 'PermissionRevoked';

  constructor(
    eventId: string,
    public readonly payload: AuthorizationEventPayload & {
      employeeId: string;
      permissionId: string;
      revokedBy: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}
