import { SetMetadata } from '@nestjs/common';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';

export const REQUIRE_PLATFORM_ADMIN_ROLE_KEY = 'requirePlatformAdminRole';

/**
 * ADR-034 §11-12: declares the set of `PlatformAdminClaims.role` values a
 * handler accepts. Clones `@RequireOrgRole`'s metadata-driven shape (OR
 * semantics — any one of the listed roles is sufficient) against the
 * Platform actor's own claim instead of `AuthenticatedActor.orgRole` — this
 * is deliberately not a reuse of `@RequireOrgRole`/`OrganizationMemberGuard`,
 * which hard-require `AUTHENTICATED_ACTOR_KEY` and would structurally never
 * see a `PlatformAdminActor` (set under the separate `PLATFORM_ADMIN_ACTOR_KEY`).
 * Always combined with `PlatformAdminGuard` running first on the same route
 * (`@UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)`) — this decorator
 * only narrows within an already-authenticated Platform Admin, it never
 * authenticates by itself.
 */
export const RequirePlatformAdminRole = (...roles: PlatformAdminRole[]): MethodDecorator =>
  SetMetadata(REQUIRE_PLATFORM_ADMIN_ROLE_KEY, roles);
