/**
 * ADR-022 (Phase 2.23): minimal read boundary for `PlatformAdminGuard`'s
 * live revocation check, mirroring `SessionVersionGuard`'s "trust the JWT
 * for identity, but still verify current live state" pattern. Does not
 * cover Platform Admin provisioning/management (out of this phase's scope
 * — an existing `PlatformAdmin` row is assumed to already exist, created by
 * some other operational means outside this codebase, e.g. a direct
 * database operation by whoever runs the platform).
 */
export interface PlatformAdminRepository {
  isActiveAdmin(userId: string): Promise<boolean>;
}

export const PLATFORM_ADMIN_REPOSITORY = Symbol('PLATFORM_ADMIN_REPOSITORY');
