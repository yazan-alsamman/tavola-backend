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
