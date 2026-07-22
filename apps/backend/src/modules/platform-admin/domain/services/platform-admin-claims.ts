/**
 * Deliberately minimal and structurally distinct from `AccessTokenClaims`
 * (the Customer/Owner/Employee/OrganizationMember shape) -
 * AUTHENTICATION_ARCHITECTURE.md §5.2: "Platform admin: separate issuer/
 * audience; minimal claims; never mixed with tenant tokens." No
 * sessionId/sessionVersion/tokenFamilyId/permissions - Platform Admin
 * access is a short-lived, stateless, re-login-on-expiry credential, not a
 * DeviceSession-backed session (ADR-022 §"Platform Admin Authentication":
 * "Do NOT invent unrelated Platform Admin functionality").
 */
export interface PlatformAdminClaims {
  sub: string;
  iat?: number;
  exp?: number;
}
