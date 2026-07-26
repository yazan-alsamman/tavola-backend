import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { TenantContextPort } from '@shared/application/ports/tenant-context.port';
import { TenantContext } from './tenant-context.types';

/**
 * AsyncLocalStorage-backed tenant identity store (TENANCY.md, ADR-012).
 * Deliberately a separate store from `PrismaContext`'s transaction-client
 * AsyncLocalStorage — tenant identity and the active transaction client are
 * two independent concerns that happen to both use ALS for the same reason
 * (avoiding parameter-threading through every layer).
 *
 * Implements `TenantContextPort` so bootstrap/system use cases (e.g.
 * self-registration, Phase 2.13.1) can depend on the application-layer port
 * rather than this concrete infrastructure class.
 */
@Injectable()
export class TenantContextService implements TenantContextPort {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  /**
   * For synchronous callbacks, or callbacks that themselves subscribe to
   * their async work before returning (e.g. the interceptor's
   * `next.handle().subscribe(subscriber)` — the `.subscribe()` call itself
   * is what needs to happen inside `run()`, not the eventual emission).
   *
   * Do NOT use this with a callback that just returns an un-awaited Promise,
   * e.g. `run(ctx, () => prisma.model.findMany())` — Prisma's client
   * operations are lazy thenables whose real work (including this
   * extension's own logic) only starts when something calls `.then()`/
   * `await`s them. `AsyncLocalStorage.run()` only propagates context into
   * continuations that are subscribed *while still inside* the callback's
   * synchronous execution; an un-awaited promise returned from here gets
   * `.then()`-ed by the *caller*, outside this scope, so the bound context
   * would silently be gone by the time Prisma's extension actually runs.
   * Use {@link runAsync} for any Promise-returning callback instead.
   */
  run<T>(context: TenantContext, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  /**
   * Safe variant for Promise-returning callbacks (repository/use-case calls,
   * Prisma operations, etc.) — awaits `callback()` *inside* the ALS-bound
   * callback, so the `.then()` subscription that actually starts a lazy
   * Prisma operation happens while the context is still active. See the
   * warning on {@link run}.
   */
  runAsync<T>(context: TenantContext, callback: () => Promise<T>): Promise<T> {
    return this.storage.run(context, async () => callback());
  }

  getContext(): TenantContext | undefined {
    return this.storage.getStore();
  }

  getOrganizationId(): string | null {
    return this.storage.getStore()?.organizationId ?? null;
  }

  /**
   * Recovers the currently-acting actor's type from the same ALS scope
   * `getOrganizationId()` reads — added for the Phase 8 `AuditingEventPublisher`
   * hygiene fix, where a Reservation event payload (e.g. `cancelledBy`) carries
   * only an id that is ambiguously either a `User.id` or an `Employee.id`
   * (Cancel/Reschedule are reachable by both actor types). `undefined` on the
   * stored context (bootstrap/`TenantBootstrapContext` callers) collapses to
   * `null`, same as `getOrganizationId()`.
   */
  getActorType(): 'User' | 'Employee' | 'OrganizationMember' | null {
    return this.storage.getStore()?.actorType ?? null;
  }
}
