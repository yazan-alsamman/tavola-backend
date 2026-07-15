import { SetMetadata } from '@nestjs/common';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';

export const REQUIRE_ORG_ROLE_KEY = 'requireOrgRole';

/**
 * Declares the set of `OrganizationMember.role` values a handler accepts
 * (AUTHORIZATION_ARCHITECTURE.md §9/§13 - the "Organization administrative"
 * layer, distinct from Employee RBAC and never combined with it on the same
 * route, per §2.1/§14 "these layers must never be conflated"). Any one of
 * the listed roles is sufficient (OR semantics), matching
 * `@RequirePermission`'s existing single-decorator-per-route pattern rather
 * than introducing new decorator variants this phase does not need.
 */
export const RequireOrgRole = (...roles: OrganizationMemberRole[]): MethodDecorator =>
  SetMetadata(REQUIRE_ORG_ROLE_KEY, roles);
