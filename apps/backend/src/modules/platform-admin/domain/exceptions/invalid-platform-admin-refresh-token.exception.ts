import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Deliberately identical for every failure mode — unknown token, revoked
 * session, expired session, or a detected replay — so a caller can never
 * probe which of those applies. Mirrors `InvalidRefreshTokenException` on
 * the tenant pipeline exactly, including its `AUTH_INVALID_REFRESH_TOKEN`
 * code and 401 status, so a console can treat both pipelines identically.
 */
export class InvalidPlatformAdminRefreshTokenException extends DomainException {
  public readonly code = 'AUTH_INVALID_REFRESH_TOKEN';

  constructor() {
    super('Invalid or expired refresh token.', 401);
  }
}
