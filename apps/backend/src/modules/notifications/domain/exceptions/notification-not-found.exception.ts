import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Phase 9 decision item 13 (ownership-only authorization, IDOR-safe): a
 * non-owned or nonexistent `:id` collapses to this same exception -
 * `NotificationsController` never distinguishes "not found" from "not
 * yours", matching every other owned-resource route's existing convention.
 */
export class NotificationNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Notification not found.', 404);
  }
}
