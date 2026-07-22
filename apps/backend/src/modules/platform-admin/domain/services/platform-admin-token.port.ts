import { PlatformAdminClaims } from './platform-admin-claims';

/**
 * Separate signing/verification boundary from `TokenService`
 * (Customer/Owner/Employee/OrganizationMember) - its own secret, issuer,
 * and audience (ADR-022 §"Platform Admin Authentication"). A token this
 * service will not verify (wrong secret, wrong issuer, wrong audience,
 * expired, malformed) must throw - callers never fall back to the ordinary
 * `TokenService`.
 */
export interface PlatformAdminTokenService {
  signAccessToken(claims: PlatformAdminClaims): string;
  verifyAccessToken(token: string): PlatformAdminClaims;
}

export const PLATFORM_ADMIN_TOKEN_SERVICE = Symbol('PLATFORM_ADMIN_TOKEN_SERVICE');
