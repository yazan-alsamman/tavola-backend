import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Thrown when the tenant-scoped Prisma Client Extension (TENANCY.md, ADR-012)
 * executes an operation against a tenant-owned model with no TenantContext
 * bound. This is a fail-closed control, not a client-input error: it always
 * indicates a code path that should have established tenant context (or
 * deliberately used the `$systemContext` escape hatch) but didn't — mapped
 * to `TENANT_CONTEXT_MISSING` (API_GUIDELINES.md) and HTTP 500, since it is
 * never something the calling client can correct.
 */
export class TenantContextMissingException extends DomainException {
  public readonly code = 'TENANT_CONTEXT_MISSING';

  constructor(model: string, operation: string) {
    super(`Tenant context is required for "${model}.${operation}" but none is bound.`, 500);
  }
}
