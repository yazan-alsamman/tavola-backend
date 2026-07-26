import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Phase 9 decision item 5 (frozen push state machine): raised whenever a
 * `Notification`'s push track is transitioned outside
 * `NotAttempted -> Queued -> {Accepted | Failed}`. Both `Accepted`/`Failed`
 * are terminal - never re-entered once written.
 */
export class InvalidNotificationPushTransitionException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(message: string) {
    super(message, 400);
  }
}
