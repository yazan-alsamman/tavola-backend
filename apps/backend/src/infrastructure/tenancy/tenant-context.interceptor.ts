import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import {
  AUTHENTICATED_ACTOR_KEY,
  AuthenticatedActor,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import { resolveCorrelationId } from '@infrastructure/logging/correlation-id.util';
import { TenantContextService } from './tenant-context.service';

/**
 * Binds TenantContext for the lifetime of every HTTP request (TENANCY.md,
 * ADR-012). Registered globally (see TenancyModule) so it runs for every
 * route — NestJS's own execution order (guards, then interceptors) already
 * guarantees this runs after JwtAuthGuard/SessionVersionGuard resolve the
 * actor, without any extra ordering configuration.
 *
 * `organizationId` comes ONLY from `request[AUTHENTICATED_ACTOR_KEY]`, which
 * only a guard can set from verified JWT claims — never from body, query,
 * params, or any client-supplied header. Public routes (no auth guard) and
 * the Customer `User` actor type (which carries no organizationId per
 * AUTHENTICATION_ARCHITECTURE.md §2.2) both correctly resolve to
 * `organizationId: null` here — that is a valid state, not an error; only a
 * tenant-owned Prisma query executed with no context throws.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContextService: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const actor = request[AUTHENTICATED_ACTOR_KEY] as AuthenticatedActor | undefined;

    const headers = request.headers as Record<string, string | string[] | undefined> | undefined;
    const organizationId = extractOrganizationId(actor);
    const userId = extractUserId(actor);
    const correlationId = resolveCorrelationId(headers?.['x-correlation-id']);

    return new Observable((subscriber) => {
      this.tenantContextService.run({ organizationId, userId, correlationId }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}

/**
 * Structural (not actor-type-switch) extraction: `AuthenticatedUserActor`
 * carries no `organizationId`, so a plain Customer session always resolves to
 * `null` here. `AuthenticatedEmployeeActor`/`AuthenticatedOrganizationMemberActor`
 * (Phase 2.14) do carry one, and are picked up automatically by this same
 * property check with no change needed — exactly the reason it was written
 * structurally rather than as a switch over a specific actor-type shape.
 */
function extractOrganizationId(actor: AuthenticatedActor | undefined): string | null {
  if (!actor || !('organizationId' in actor)) {
    return null;
  }
  const value = (actor as { organizationId?: unknown }).organizationId;
  return typeof value === 'string' ? value : null;
}

function extractUserId(actor: AuthenticatedActor | undefined): string | null {
  return actor?.userId ?? null;
}
