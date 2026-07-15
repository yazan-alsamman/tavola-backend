import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { withTenantScoping } from '@infrastructure/tenancy/tenant-scoped-prisma.extension';

type TenantScopedPrismaClient = ReturnType<typeof withTenantScoping<PrismaService>>;

/**
 * The extended client's own `$transaction` callback parameter type - derived
 * by inference rather than hand-declared as `Prisma.TransactionClient`,
 * because an extended client's transaction handle carries extension-specific
 * type arguments that the plain (unextended) `Prisma.TransactionClient` type
 * is not assignable from.
 */
type TenantScopedTransactionClient = TenantScopedPrismaClient extends {
  $transaction<T>(fn: (client: infer C) => Promise<T>): Promise<T>;
}
  ? C
  : never;

export type PrismaDbClient = TenantScopedPrismaClient | TenantScopedTransactionClient;

/**
 * The single client every repository is expected to inject (see
 * PrismaService's own doc comment). Tenant-scoping (TENANCY.md, ADR-012) is
 * applied here, not as a separate parallel client, for a reason that is not
 * optional: a Prisma Client Extension's query hooks only propagate into an
 * interactive transaction's `tx` when `$transaction(...)` is called on the
 * already-extended client — `Prisma.TransactionClient`'s own type excludes
 * `$extends`, so scoping cannot be retrofitted onto a `tx` obtained from an
 * unextended client. Starting every transaction from the extended client
 * here is therefore the only way `PrismaUnitOfWork` (which always goes
 * through `runInTransaction`) can preserve tenant scoping across a
 * transaction boundary (Phase 2.13.1).
 *
 * This is safe for every repository that does NOT touch a tenant-owned
 * model: `withTenantScoping`'s extension is a verified no-op passthrough for
 * any model outside its allowlist, so global repositories (User,
 * DeviceSession, TokenFamily, etc.) are functionally unaffected. The one
 * deliberate exception is `PrismaLoginOrganizationReader`, which injects
 * `PrismaService` directly instead of this class — see its own doc comment.
 */
@Injectable()
export class PrismaContext {
  private readonly scopedPrisma: TenantScopedPrismaClient;
  private readonly storage = new AsyncLocalStorage<TenantScopedTransactionClient>();

  constructor(prisma: PrismaService, tenantContextService: TenantContextService) {
    this.scopedPrisma = withTenantScoping(prisma, tenantContextService);
  }

  get client(): PrismaDbClient {
    return this.storage.getStore() ?? this.scopedPrisma;
  }

  async runInTransaction<T>(work: () => Promise<T>): Promise<T> {
    return this.scopedPrisma.$transaction(async (tx) => this.storage.run(tx, work));
  }
}
