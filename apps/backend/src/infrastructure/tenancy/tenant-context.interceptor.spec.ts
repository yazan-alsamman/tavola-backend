import { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, of } from 'rxjs';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import { TenantContextService } from './tenant-context.service';
import {
  AUTHENTICATED_ACTOR_KEY,
  AuthenticatedUserActor,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';

function createExecutionContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}

function createCallHandler(observedDuringHandling: () => void): CallHandler {
  return {
    handle: () => {
      observedDuringHandling();
      return of('handler-result');
    },
  };
}

async function run(observable: ReturnType<CallHandler['handle']>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    observable.subscribe({ next: resolve, error: reject });
  });
}

describe('TenantContextInterceptor', () => {
  const currentActor: AuthenticatedUserActor = {
    actorType: AccessTokenActorType.User,
    userId: 'user-1',
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
  };

  it('binds organizationId: null and userId: null for public (unauthenticated) routes', async () => {
    const tenantContextService = new TenantContextService();
    const interceptor = new TenantContextInterceptor(tenantContextService);
    let observed: unknown;

    const context = createExecutionContext({ headers: {} });
    const handler = createCallHandler(() => {
      observed = tenantContextService.getContext();
    });

    const result = await run(interceptor.intercept(context, handler));

    expect(result).toBe('handler-result');
    expect(observed).toMatchObject({ organizationId: null, userId: null });
    expect(tenantContextService.getContext()).toBeUndefined();
  });

  it('keeps context bound through genuinely asynchronous handler continuations, not just synchronous ones', async () => {
    // Regression test for a real bug found while building this interceptor:
    // context only propagates into continuations subscribed WHILE still
    // inside TenantContextService.run()'s synchronous window. A handler
    // that does real async work (like every real controller/use-case/Prisma
    // chain) must still see the bound context deep inside that chain, not
    // just at the moment `next.handle()` is first called.
    const tenantContextService = new TenantContextService();
    const interceptor = new TenantContextInterceptor(tenantContextService);
    const observed: unknown[] = [];

    const request: Record<string, unknown> = { headers: {} };
    request[AUTHENTICATED_ACTOR_KEY] = { ...currentActor, organizationId: 'org-async-42' };
    const context = createExecutionContext(request);

    const handler: CallHandler = {
      handle: () =>
        defer(async () => {
          observed.push(tenantContextService.getContext());
          await new Promise((resolve) => setTimeout(resolve, 5));
          observed.push(tenantContextService.getContext());
          await Promise.resolve().then(() => Promise.resolve());
          observed.push(tenantContextService.getContext());
          return 'async-handler-result';
        }),
    };

    const result = await run(interceptor.intercept(context, handler));

    expect(result).toBe('async-handler-result');
    expect(observed).toHaveLength(3);
    for (const snapshot of observed) {
      expect(snapshot).toMatchObject({ organizationId: 'org-async-42' });
    }
  });

  it('binds organizationId: null for the current Customer/User actor shape (no organizationId field)', async () => {
    const tenantContextService = new TenantContextService();
    const interceptor = new TenantContextInterceptor(tenantContextService);
    let observed: unknown;

    const request: Record<string, unknown> = { headers: {} };
    request[AUTHENTICATED_ACTOR_KEY] = currentActor;
    const context = createExecutionContext(request);
    const handler = createCallHandler(() => {
      observed = tenantContextService.getContext();
    });

    await run(interceptor.intercept(context, handler));

    expect(observed).toMatchObject({ organizationId: null, userId: 'user-1' });
  });

  it('extracts organizationId structurally from any actor shape that carries one', async () => {
    const tenantContextService = new TenantContextService();
    const interceptor = new TenantContextInterceptor(tenantContextService);
    let observed: unknown;

    // Simulates a future Employee/OrganizationMember actor shape — the
    // interceptor must not need code changes when that actor type lands,
    // since extraction is structural (checks for the property), not a
    // switch over today's single actor type.
    const futureActor = { ...currentActor, organizationId: 'org-42' };
    const request: Record<string, unknown> = { headers: {} };
    request[AUTHENTICATED_ACTOR_KEY] = futureActor;
    const context = createExecutionContext(request);
    const handler = createCallHandler(() => {
      observed = tenantContextService.getContext();
    });

    await run(interceptor.intercept(context, handler));

    expect(observed).toMatchObject({ organizationId: 'org-42', userId: 'user-1' });
  });

  it('ignores a non-string organizationId rather than binding garbage', async () => {
    const tenantContextService = new TenantContextService();
    const interceptor = new TenantContextInterceptor(tenantContextService);
    let observed: unknown;

    const malformedActor = { ...currentActor, organizationId: 12345 };
    const request: Record<string, unknown> = { headers: {} };
    request[AUTHENTICATED_ACTOR_KEY] = malformedActor;
    const context = createExecutionContext(request);
    const handler = createCallHandler(() => {
      observed = tenantContextService.getContext();
    });

    await run(interceptor.intercept(context, handler));

    expect(observed).toMatchObject({ organizationId: null });
  });

  it('binds actorType from the authenticated actor (Phase 8 audit-hygiene fix)', async () => {
    const tenantContextService = new TenantContextService();
    const interceptor = new TenantContextInterceptor(tenantContextService);
    let observed: unknown;

    const request: Record<string, unknown> = { headers: {} };
    request[AUTHENTICATED_ACTOR_KEY] = currentActor;
    const context = createExecutionContext(request);
    const handler = createCallHandler(() => {
      observed = tenantContextService.getContext();
    });

    await run(interceptor.intercept(context, handler));

    expect(observed).toMatchObject({ actorType: AccessTokenActorType.User });
  });

  it('binds actorType: null for public (unauthenticated) routes', async () => {
    const tenantContextService = new TenantContextService();
    const interceptor = new TenantContextInterceptor(tenantContextService);
    let observed: unknown;

    const context = createExecutionContext({ headers: {} });
    const handler = createCallHandler(() => {
      observed = tenantContextService.getContext();
    });

    await run(interceptor.intercept(context, handler));

    expect(observed).toMatchObject({ actorType: null });
  });

  it('uses a safe client-supplied correlation id when present', async () => {
    const tenantContextService = new TenantContextService();
    const interceptor = new TenantContextInterceptor(tenantContextService);
    let observed: unknown;

    const context = createExecutionContext({ headers: { 'x-correlation-id': 'req-abc-123' } });
    const handler = createCallHandler(() => {
      observed = tenantContextService.getContext();
    });

    await run(interceptor.intercept(context, handler));

    expect(observed).toMatchObject({ correlationId: 'req-abc-123' });
  });

  it('generates a correlation id when none/unsafe is supplied', async () => {
    const tenantContextService = new TenantContextService();
    const interceptor = new TenantContextInterceptor(tenantContextService);
    let observed: { correlationId?: string } | undefined;

    const context = createExecutionContext({ headers: { 'x-correlation-id': 'unsafe value!' } });
    const handler = createCallHandler(() => {
      observed = tenantContextService.getContext();
    });

    await run(interceptor.intercept(context, handler));

    expect(observed?.correlationId).toBeDefined();
    expect(observed?.correlationId).not.toBe('unsafe value!');
  });
});
