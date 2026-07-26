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
 */
export interface TenantContext {
  readonly organizationId: string | null;
  readonly userId: string | null;
  readonly correlationId: string;
  readonly actorType?: 'User' | 'Employee' | 'OrganizationMember' | null;
}
