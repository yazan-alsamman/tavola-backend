import { registerAs } from '@nestjs/config';

/**
 * ADR-022 §"Platform Admin Authentication" (approved decision, Phase 2.23
 * closure): a genuinely separate signing configuration - own secret, own
 * issuer, own audience - never the same as JWT_ACCESS_SECRET/JWT_ISSUER/
 * JWT_AUDIENCE used for Customer/Owner/Employee/OrganizationMember tokens.
 * AUTHENTICATION_ARCHITECTURE.md §5.2: "Platform admin: separate issuer/
 * audience; minimal claims; never mixed with tenant tokens."
 */
export default registerAs('platformAdminAuth', () => ({
  jwtSecret: process.env.PLATFORM_ADMIN_JWT_SECRET ?? '',
  jwtIssuer: process.env.PLATFORM_ADMIN_JWT_ISSUER ?? 'tavla-platform-admin',
  jwtAudience: process.env.PLATFORM_ADMIN_JWT_AUDIENCE ?? 'tavla-platform-admin-clients',
  jwtExpirySeconds: parseInt(process.env.PLATFORM_ADMIN_JWT_EXPIRY_SECONDS ?? '900', 10),
}));

export interface PlatformAdminAuthConfig {
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  jwtExpirySeconds: number;
}
