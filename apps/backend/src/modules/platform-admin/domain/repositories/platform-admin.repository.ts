import { PlatformAdminRole } from '../enums/platform-admin.enums';

export interface PlatformAdminAuthContext {
  readonly role: PlatformAdminRole;
}

export interface PlatformAdminRecord {
  readonly id: string;
  readonly userId: string;
  readonly role: PlatformAdminRole;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}

export interface PlatformAdminListPage {
  readonly items: PlatformAdminRecord[];
  readonly total: number;
}

/**
 * ADR-022 (Phase 2.23) originally scoped this port to the single
 * `isActiveAdmin` read `PlatformAdminGuard` needs. Phase 19.1 (ADR-034 §10-12)
 * extends it to a full CRUD boundary — `findActiveAdminContext` replaces
 * `isActiveAdmin` (same live-revocation-check role, now also returning
 * `role` so both the guard and login use case can source it from one DB
 * round trip instead of two).
 */
export interface PlatformAdminRepository {
  /**
   * Mirrors `SessionVersionGuard`'s "trust the JWT for identity, but still
   * verify current live state" pattern — `null` when the row does not exist
   * or has been revoked. Used by `PlatformAdminGuard` on every request and by
   * `PlatformAdminLoginUseCase` to resolve the role to embed in a freshly
   * issued token.
   */
  findActiveAdminContext(userId: string): Promise<PlatformAdminAuthContext | null>;
  findById(id: string): Promise<PlatformAdminRecord | null>;
  findByUserId(userId: string): Promise<PlatformAdminRecord | null>;
  list(page: number, limit: number): Promise<PlatformAdminListPage>;
  create(record: PlatformAdminRecord): Promise<void>;
  updateRole(id: string, role: PlatformAdminRole, at: Date): Promise<void>;
  revoke(id: string, at: Date): Promise<void>;
  reactivate(id: string): Promise<void>;
}

export const PLATFORM_ADMIN_REPOSITORY = Symbol('PLATFORM_ADMIN_REPOSITORY');
