import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiSuccessResponse } from '../interfaces/api-response.interface';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';
import { SKIP_RESPONSE_ENVELOPE_KEY } from '../decorators/skip-response-envelope.decorator';

/**
 * Wraps every successful controller return value in the standard success
 * envelope from API_GUIDELINES.md. Handlers return plain data (or throw);
 * they never construct { success, message, data, meta } themselves.
 *
 * Routes marked with @SkipResponseEnvelope() (health checks, /metrics) pass
 * through untouched - they have their own required response contracts.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccessResponse<T> | T
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T> | T> {
    const skip = this.reflector.get<boolean>(SKIP_RESPONSE_ENVELOPE_KEY, context.getHandler());

    if (skip) {
      return next.handle();
    }

    const message =
      this.reflector.get<string>(RESPONSE_MESSAGE_KEY, context.getHandler()) ??
      'Request successful.';

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        message,
        data,
        meta: {},
      })),
    );
  }
}
