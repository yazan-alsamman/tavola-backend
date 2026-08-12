import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Phase 19.9 (ADR-037) — a Platform Admin single-Customer send's target
 * `userId` collapses to this same exception whether the id does not exist,
 * belongs to a PlatformAdmin/OrganizationMember/Employee, or belongs to an
 * inactive/deleted account: never a distinguishing error that would let a
 * caller enumerate internal identities or account states (the same
 * IDOR-safe-404 convention `NotificationNotFoundException` already
 * establishes for this module).
 */
export class CustomerNotFoundException extends DomainException {
  public readonly code = 'NOT_FOUND';

  constructor() {
    super('Customer not found.', 404);
  }
}
