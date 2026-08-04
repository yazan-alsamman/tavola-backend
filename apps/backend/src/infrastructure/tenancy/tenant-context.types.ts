/**
 * Per-request tenant identity, bound into AsyncLocalStorage by
 * TenantContextInterceptor (see TENANCY.md, ADR-012). `organizationId` is
 * `null` whenever the authenticated actor carries none (e.g. the Customer
 * `User` actor type — AUTHENTICATION_ARCHITECTURE.md §2.2, "Customer User
 * has no Organization by default") — this is a valid, expected state, not
 * an error; only a tenant-owned Prisma query executed with no context bound
 * at all is an error (TenantContextMissingException).
 *
 * `actorType` is optional (absent for bootstrap/system `TenantBootstrapContext`
 * callers — see `tenant-context.port.ts` — which have no HTTP actor at all)
 * and exists solely so infrastructure classes that run inside the same ALS
 * scope as a request (e.g. `AuditingEventPublisher`, Phase 8 audit-hygiene
 * fix) can recover which actor type is currently acting without threading it
 * through every domain event payload — see `TenantContextService.getActorType()`.
 *
 * `'PlatformAdmin'` (Phase 19.1, ADR-034 §1/§3-4) is set only by the new
 * PlatformAdmin Restaurant/Organization lifecycle use cases when they
 * Explicit-Tenant-Rebind (ADR-035 Pattern 1) via `TenantContextPort.runAsync`
 * — the same mechanism that already disambiguates `TableMerged`/
 * `ReservationCancelled`, extended with one more value rather than a new
 * mechanism, so events Owner/Admin and PlatformAdmin can both now produce
 * (`RestaurantSuspended`, `OrganizationSuspended`, …) attribute correctly.
 */
export interface TenantContext {
  readonly organizationId: string | null;
  readonly userId: string | null;
  readonly correlationId: string;
  readonly actorType?: 'User' | 'Employee' | 'OrganizationMember' | 'PlatformAdmin' | null;
}
