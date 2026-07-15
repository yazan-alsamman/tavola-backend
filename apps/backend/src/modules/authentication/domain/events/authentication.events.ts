import { DomainEvent } from '@shared/domain/base/domain-event.base';

export interface AuthEventPayload {
  userId: string;
  correlationId?: string;
}

export class UserRegisteredEvent extends DomainEvent {
  public readonly eventName = 'UserRegistered';
  public readonly payload: AuthEventPayload & { email: string };

  constructor(
    eventId: string,
    payload: AuthEventPayload & { email: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

export class EmailVerifiedEvent extends DomainEvent {
  public readonly eventName = 'EmailVerified';
  public readonly payload: AuthEventPayload;

  constructor(
    eventId: string,
    payload: AuthEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

export class UserLoggedInEvent extends DomainEvent {
  public readonly eventName = 'UserLoggedIn';
  public readonly payload: AuthEventPayload & {
    sessionId: string;
    tokenFamilyId: string;
    ipAddress?: string;
  };

  constructor(
    eventId: string,
    payload: AuthEventPayload & {
      sessionId: string;
      tokenFamilyId: string;
      ipAddress?: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

export class UserLoggedOutEvent extends DomainEvent {
  public readonly eventName = 'UserLoggedOut';

  constructor(
    eventId: string,
    public readonly payload: AuthEventPayload & {
      sessionId?: string;
      scope: 'current' | 'all';
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class SessionRevokedEvent extends DomainEvent {
  public readonly eventName = 'SessionRevoked';
  public readonly payload: AuthEventPayload & {
    sessionId: string;
    reason: string;
  };

  constructor(
    eventId: string,
    payload: AuthEventPayload & {
      sessionId: string;
      reason: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

export class SessionRefreshedEvent extends DomainEvent {
  public readonly eventName = 'SessionRefreshed';
  public readonly payload: AuthEventPayload & {
    sessionId: string;
    tokenFamilyId: string;
  };

  constructor(
    eventId: string,
    payload: AuthEventPayload & {
      sessionId: string;
      tokenFamilyId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

export class TokenReplayDetectedEvent extends DomainEvent {
  public readonly eventName = 'TokenReplayDetected';
  public readonly payload: AuthEventPayload & {
    sessionId: string;
    tokenFamilyId: string;
    ipAddress?: string;
  };

  constructor(
    eventId: string,
    payload: AuthEventPayload & {
      sessionId: string;
      tokenFamilyId: string;
      ipAddress?: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

export class SessionFamilyRevokedEvent extends DomainEvent {
  public readonly eventName = 'SessionFamilyRevoked';
  public readonly payload: AuthEventPayload & {
    tokenFamilyId: string;
    reason: string;
  };

  constructor(
    eventId: string,
    payload: AuthEventPayload & {
      tokenFamilyId: string;
      reason: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

export class TokenFamilyCompromisedEvent extends DomainEvent {
  public readonly eventName = 'TokenFamilyCompromised';
  public readonly payload: AuthEventPayload & { tokenFamilyId: string };

  constructor(
    eventId: string,
    payload: AuthEventPayload & { tokenFamilyId: string },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

export class AccountLockedEvent extends DomainEvent {
  public readonly eventName = 'AccountLocked';
  public readonly payload: AuthEventPayload & {
    lockedUntil: Date;
    failedAttempts: number;
  };

  constructor(
    eventId: string,
    payload: AuthEventPayload & {
      lockedUntil: Date;
      failedAttempts: number;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
    this.payload = payload;
    this.seal();
  }
}

export class PasswordChangedEvent extends DomainEvent {
  public readonly eventName = 'PasswordChanged';

  constructor(
    eventId: string,
    public readonly payload: AuthEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class PasswordResetRequestedEvent extends DomainEvent {
  public readonly eventName = 'PasswordResetRequested';

  constructor(
    eventId: string,
    public readonly payload: AuthEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

export class PasswordResetCompletedEvent extends DomainEvent {
  public readonly eventName = 'PasswordResetCompleted';

  constructor(
    eventId: string,
    public readonly payload: AuthEventPayload,
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}
