import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * An illegal `PlatformAdminSession` state change (rotating a revoked or
 * expired session, creating one already expired). A 409 rather than a 400:
 * the request is well-formed, it is the session's current state that makes
 * it inapplicable — same status/shape convention as
 * `InvalidNotificationBroadcastTransitionException`.
 */
export class InvalidPlatformAdminSessionTransitionException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor(message: string) {
    super(message, 409);
  }
}
