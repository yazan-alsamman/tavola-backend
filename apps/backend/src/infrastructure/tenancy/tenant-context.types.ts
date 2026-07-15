/**
 * Per-request tenant identity, bound into AsyncLocalStorage by
 * TenantContextInterceptor (see TENANCY.md, ADR-012). `organizationId` is
 * `null` whenever the authenticated actor carries none (e.g. the Customer
 * `User` actor type — AUTHENTICATION_ARCHITECTURE.md §2.2, "Customer User
 * has no Organization by default") — this is a valid, expected state, not
 * an error; only a tenant-owned Prisma query executed with no context bound
 * at all is an error (TenantContextMissingException).
 */
export interface TenantContext {
  readonly organizationId: string | null;
  readonly userId: string | null;
  readonly correlationId: string;
}
