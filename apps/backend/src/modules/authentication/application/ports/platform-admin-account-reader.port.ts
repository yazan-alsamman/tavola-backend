/**
 * What kind of principal a `User` row represents, resolved from which
 * relations exist rather than stored on the row. `User` is a shared table
 * (DOMAIN_MODEL.md: an Employee's login identity *is* a User), so there is
 * no `actorType` column to read — a console that needs to show "who is
 * this account" has to have that derived server-side, or it ends up
 * reimplementing the derivation itself from several list endpoints.
 *
 * Resolution is first-match in this order, which is also precedence order:
 * a Platform Admin who also happens to own an Organization is still
 * reported as `PlatformAdmin`, because that is the authority that matters
 * operationally.
 */
export type PlatformAdminAccountType =
  'PlatformAdmin' | 'OrganizationMember' | 'Employee' | 'Customer';

export interface PlatformAdminAccountRow {
  readonly userId: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly username: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly status: string;
  readonly accountType: PlatformAdminAccountType;
  readonly emailVerified: boolean;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
}

/** One Organization the account belongs to, for the detail view. */
export interface PlatformAdminAccountOrganizationRow {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly role: string;
  readonly status: string;
}

export interface PlatformAdminAccountDetailRow extends PlatformAdminAccountRow {
  readonly language: string;
  readonly preferredCurrency: string | null;
  readonly notificationOptIn: boolean;
  readonly marketingOptIn: boolean;
  /**
   * Operational state a support console needs in order to answer "why can't
   * this person log in?" without a second call to four different places.
   * `failedLoginCount`/`lockedUntil` back the existing Enable/Disable Login
   * and Force Logout actions on this same controller.
   */
  readonly failedLoginCount: number;
  readonly lockedUntil: Date | null;
  readonly passwordChangedAt: Date | null;
  readonly deletionRequestedAt: Date | null;
  readonly scheduledAnonymizationAt: Date | null;
  readonly anonymizedAt: Date | null;
  readonly activeSessionCount: number;
  readonly organizations: PlatformAdminAccountOrganizationRow[];
  readonly updatedAt: Date;
}

export interface PlatformAdminAccountQuery {
  /**
   * Case-insensitive partial match across email, phone, username, first and
   * last name. Empty or whitespace-only means "no text filter" and returns
   * the ordinary paginated list — the requirement that made this endpoint
   * necessary in the first place, since a console must be able to *browse*
   * accounts to obtain a `userId`, not only look one up by a UUID the
   * operator already somehow knows.
   */
  readonly q: string;
  /** Matches `UserStatus` exactly (Pending/Active/Suspended/Locked/Deleted/Anonymized). */
  readonly status?: string;
  readonly accountType?: PlatformAdminAccountType;
  readonly page: number;
  readonly limit: number;
}

/**
 * ADR-035 Pattern 2 (Tenant-Agnostic Raw Reader) — a genuinely cross-tenant
 * read with no single tenant to bind: `User` is platform-wide and a Customer
 * belongs to no Organization at all (TENANCY.md: "Customer-owned models that
 * legitimately span multiple organizations ... carry no direct
 * organizationId"). Same shape as `AuditLogReaderPort` and the Restaurant/
 * Organization lookup readers.
 *
 * Read-only, and deliberately narrow: it returns identity and operational
 * state only. It never exposes `passwordHash`, `sessionVersion`, or
 * `permissionsVersion` — none of which a console can act on, and the first of
 * which must never leave the database.
 */
export interface PlatformAdminAccountReaderPort {
  search(
    query: PlatformAdminAccountQuery,
  ): Promise<{ items: PlatformAdminAccountRow[]; total: number }>;

  findDetailById(userId: string): Promise<PlatformAdminAccountDetailRow | null>;
}

export const PLATFORM_ADMIN_ACCOUNT_READER = Symbol('PLATFORM_ADMIN_ACCOUNT_READER');
