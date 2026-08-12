export interface CustomerAudienceBatch {
  readonly userIds: readonly string[];
  /** `null` once the audience is exhausted - the caller's own signal to stop paginating. */
  readonly nextCursor: string | null;
}

/**
 * ADR-037 Pattern 2 (ADR-035) — the seventh cross-tenant raw reader
 * alongside `PlatformAdminNotificationStatsReaderPort` et al. "Customer" has
 * no dedicated table (a `User` row with no `OrganizationMember`/`Employee`/
 * `PlatformAdmin` row - ADR-022); this port is the single canonical place
 * that classification is queried, reused identically by both the Platform
 * Admin and the Restaurant Owner broadcast (ADR-037 Decision #4 - one
 * audience definition, not two) and by the single-Customer admin send.
 *
 * `isEligibleCustomer` (single-target validation) and the broadcast-audience
 * methods deliberately apply DIFFERENT filters: a Platform Admin sending to
 * one named Customer is not a marketing action, so `marketingOptIn` never
 * gates it; a broadcast is explicitly filtered by `marketingOptIn` per the
 * Owner's product decision (ADR-037). Both still require: a real Customer
 * identity, `status = Active`, `deletedAt IS NULL`,
 * `deletionRequestedAt IS NULL` (never target/broadcast to an account mid
 * account-deletion).
 */
export interface CustomerAudienceReaderPort {
  isEligibleCustomer(userId: string): Promise<boolean>;

  countBroadcastEligibleCustomers(): Promise<number>;

  /** Keyset-paginated (`User.id` ascending) — never `OFFSET`, per CODING_STANDARDS.md's N+1/scale rule. */
  listBroadcastEligibleCustomerBatch(
    cursor: string | null,
    batchSize: number,
  ): Promise<CustomerAudienceBatch>;
}

export const CUSTOMER_AUDIENCE_READER = Symbol('CUSTOMER_AUDIENCE_READER');
