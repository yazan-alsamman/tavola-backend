import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Mirrors `InvalidResetTokenException`'s anti-enumeration collapse (§8 of
 * the Owner Invite audit): "not found", "already accepted", and "revoked"
 * are deliberately indistinguishable from the caller's point of view - only
 * "expired" (`ExpiredInvitationTokenException`) is a separate, informative
 * error, matching the existing password-reset precedent exactly.
 */
export class InvalidInvitationTokenException extends DomainException {
  public readonly code = 'INVALID_INVITATION_TOKEN';

  constructor() {
    super('This invitation link is invalid.', 400);
  }
}
