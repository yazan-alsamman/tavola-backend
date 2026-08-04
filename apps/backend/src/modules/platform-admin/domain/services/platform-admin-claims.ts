import { PlatformAdminRole } from '../enums/platform-admin.enums';

/**
 * Deliberately minimal and structurally distinct from `AccessTokenClaims`
 * (the Customer/Owner/Employee/OrganizationMember shape) -
 * AUTHENTICATION_ARCHITECTURE.md §5.2: "Platform admin: separate issuer/
 * audience; minimal claims; never mixed with tenant tokens." No
 * sessionId/sessionVersion/tokenFamilyId/permissions - Platform Admin
 * access is a short-lived, stateless, re-login-on-expiry credential, not a
 * DeviceSession-backed session (ADR-022 §"Platform Admin Authentication":
 * "Do NOT invent unrelated Platform Admin functionality").
 *
 * `role` (ADR-034 §11, Phase 19.1) mirrors how `OrganizationMember.role`/
 * `Employee.roleId` are embedded in their own JWT claims - never re-resolved
 * from a long-lived cache. `PlatformAdminGuard` still independently
 * re-verifies against the live `PlatformAdmin` row on every request (its
 * existing `isActiveAdmin`-style check), so a role demotion or revocation
 * takes effect immediately even mid-token-lifetime, not merely on next login.
 */
export interface PlatformAdminClaims {
  sub: string;
  role: PlatformAdminRole;
  iat?: number;
  exp?: number;
}
