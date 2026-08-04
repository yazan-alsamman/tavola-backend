import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * ADR-034 §11-12 — thrown by `PlatformAdminRoleGuard` when the caller's
 * `PlatformAdminClaims.role` is not one of the roles a `@RequirePlatformAdminRole(...)`
 * handler declares (or the metadata is missing entirely — fail-closed, same
 * default-deny convention as `OrganizationRoleRequiredException`).
 */
export class PlatformAdminRoleRequiredException extends DomainException {
  public readonly code = 'FORBIDDEN';

  constructor() {
    super('You do not have the required Platform Admin role to perform this action.', 403);
  }
}
