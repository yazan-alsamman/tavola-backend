/**
 * ADR-034 §11 — two-tier Platform role. `PlatformSupport` is read-only
 * everywhere `@RequirePlatformAdminRole` is checked; no Suspend/Delete/
 * Restore/Reversal/Manual-Record/Credential-Reset/pricing-mutation
 * authority. Mirrors the Prisma `PlatformAdminRole` enum exactly.
 */
export enum PlatformAdminRole {
  PlatformAdmin = 'PlatformAdmin',
  PlatformSupport = 'PlatformSupport',
}

/**
 * TS mirror of the Prisma `PlatformAdminSessionRevokeReason` enum.
 * Deliberately narrower than the tenant `SessionRevokeReason`: the Platform
 * Admin pipeline has no session-version bump, no self-service password
 * change and no account-deletion flow, so those values could never be
 * written here and including them would imply a shared mechanism that does
 * not exist.
 */
export enum PlatformAdminSessionRevokeReason {
  /** The admin called `POST /platform-admin/logout`. */
  Logout = 'logout',
  /** An already-rotated refresh token was presented again — treated as theft. */
  ReuseDetected = 'reuse_detected',
  /** Revoked out-of-band (admin deactivation, operational intervention). */
  Admin = 'admin',
}
