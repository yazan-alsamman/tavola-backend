/**
 * Narrow port for the one legitimate case where application-layer code must
 * itself establish tenant identity instead of relying on
 * `TenantContextInterceptor` (TENANCY.md, ADR-012): bootstrap/system
 * operations that run before any authenticated request exists — e.g.
 * self-registration, which creates an Organization and its first
 * OrganizationMember with no JWT (and therefore no interceptor-bound
 * context) in play. `organizationId` here must always be server-derived
 * (typically the id of a record the same operation just created), never
 * client-supplied input.
 */
export interface TenantBootstrapContext {
  readonly organizationId: string;
  readonly userId: string | null;
  readonly correlationId: string;
}

export interface TenantContextPort {
  runAsync<T>(context: TenantBootstrapContext, work: () => Promise<T>): Promise<T>;
}

export const TENANT_CONTEXT_PORT = Symbol('TENANT_CONTEXT_PORT');
