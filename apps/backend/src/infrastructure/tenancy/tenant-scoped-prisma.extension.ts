import { PrismaClient } from '@prisma/client';
import { TenantContextService } from './tenant-context.service';
import { TenantContextMissingException } from './tenant-context-missing.exception';

/**
 * Prisma Client Extension enforcing tenant scoping (TENANCY.md, ADR-012).
 *
 * Scope of this phase: enforcement covers the tenant-owned models that carry
 * a **direct** `organizationId` column today — `OrganizationMember` and
 * `Restaurant`. Per the schema, `Branch`/`Employee`/`EmployeeBranchAssignment`
 * are tenant-owned *transitively* (via `restaurantId` relation chains, one or
 * two hops deep) — correctly identified as such, but their enforcement is
 * deferred to whichever phase implements their first repository (Phase 5/6),
 * since relation-path injection needs per-model FK-chain logic that cannot be
 * meaningfully tested without a concrete consuming repository. Extend
 * `DIRECT_TENANT_OWNED_MODELS` (and add a relation-path strategy) when that
 * work begins — do not guess at the shape now.
 *
 * Fail-closed: any operation against a listed model with no TenantContext
 * bound throws `TenantContextMissingException` rather than running unscoped.
 * The bound context's `organizationId` always overrides any value already
 * present in a caller-supplied `where`/`data` payload — a client (or a bug
 * upstream) can never widen or redirect a query to another tenant by
 * supplying its own `organizationId`.
 */
const DIRECT_TENANT_OWNED_MODELS = new Set(['OrganizationMember', 'Restaurant']);

const WHERE_SCOPED_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

const CREATE_SCOPED_OPERATIONS = new Set(['create', 'upsert']);
const CREATE_MANY_SCOPED_OPERATIONS = new Set(['createMany', 'createManyAndReturn']);

export function withTenantScoping<T extends PrismaClient>(
  client: T,
  tenantContextService: TenantContextService,
) {
  return client.$extends({
    name: 'tenant-scoping',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!DIRECT_TENANT_OWNED_MODELS.has(model)) {
            return query(args);
          }

          const organizationId = tenantContextService.getOrganizationId();
          if (organizationId === null) {
            throw new TenantContextMissingException(model, operation);
          }

          const scopedArgs = { ...(args as Record<string, unknown>) };

          if (WHERE_SCOPED_OPERATIONS.has(operation)) {
            scopedArgs.where = {
              ...(scopedArgs.where as Record<string, unknown> | undefined),
              organizationId,
            };
          }

          if (CREATE_SCOPED_OPERATIONS.has(operation)) {
            const dataKey = operation === 'upsert' ? 'create' : 'data';
            scopedArgs[dataKey] = {
              ...(scopedArgs[dataKey] as Record<string, unknown> | undefined),
              organizationId,
            };
          }

          if (CREATE_MANY_SCOPED_OPERATIONS.has(operation)) {
            const data = scopedArgs.data;
            scopedArgs.data = Array.isArray(data)
              ? data.map((row) => ({ ...(row as Record<string, unknown>), organizationId }))
              : { ...(data as Record<string, unknown> | undefined), organizationId };
          }

          return query(scopedArgs as typeof args);
        },
      },
    },
  });
}
