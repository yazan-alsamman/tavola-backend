import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import {
  AUTHENTICATED_ACTOR_KEY,
  AuthenticatedActor,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import { MessagingConfig } from '@config/messaging.config';
import { IdempotencyStorePort } from '../../application/ports/idempotency-store.port';
import { IDEMPOTENCY_STORE } from '../../domain/tokens/messaging.tokens';

const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/**
 * DECISIONS.md D12 - opt-in: a request without an `Idempotency-Key` header
 * passes through untouched, exactly as the header's usual HTTP semantics
 * imply. Scoped to `POST /conversations` and
 * `POST /conversations/:id/messages` via `@UseInterceptors` on those two
 * routes only, never registered globally.
 *
 * Caches the raw (pre-`ResponseEnvelopeInterceptor`) controller return
 * value, keyed by `(actor, Idempotency-Key)` - a short-circuited replay
 * still flows back up through the global envelope interceptor on its way
 * out, so a replayed response is enveloped identically to a fresh one. The
 * route's own `@HttpCode` decorator (not this interceptor) determines the
 * HTTP status code on both the original call and every replay.
 */
@Injectable()
export class MessagingIdempotencyInterceptor implements NestInterceptor {
  constructor(
    @Inject(IDEMPOTENCY_STORE) private readonly idempotencyStore: IdempotencyStorePort,
    private readonly configService: ConfigService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<Request>();
    const idempotencyKeyHeader = request.headers[IDEMPOTENCY_KEY_HEADER];

    if (!idempotencyKeyHeader || Array.isArray(idempotencyKeyHeader)) {
      return next.handle();
    }

    const actor = (request as unknown as Record<string, unknown>)[AUTHENTICATED_ACTOR_KEY] as
      AuthenticatedActor | undefined;
    if (!actor) {
      return next.handle();
    }

    const key = `messaging:idempotency:${actor.userId}:${idempotencyKeyHeader}`;
    const cached = await this.idempotencyStore.get(key);
    if (cached !== null) {
      return of(cached.body);
    }

    const config = this.configService.get<MessagingConfig>('messaging', { infer: true });
    if (!config) {
      throw new Error('Messaging configuration is not loaded.');
    }

    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      tap((body: unknown) => {
        void this.idempotencyStore.save(
          key,
          { statusCode: response.statusCode, body },
          config.idempotency.ttlSeconds,
        );
      }),
    );
  }
}
