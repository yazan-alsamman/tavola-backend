import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { MetricsRegistry } from './metrics.registry';

/**
 * Records http_request_duration_seconds and http_requests_total for every
 * request, labeled by the matched route pattern (never the raw URL, which
 * would blow up cardinality with path parameters like reservation IDs).
 *
 * Hooks the raw response's "finish" event rather than the interceptor's
 * RxJS pipe: GlobalExceptionFilter runs outside/after the interceptor
 * chain, so an interceptor's own tap/map callbacks fire before the final
 * status code is written for error responses. "finish" fires only once
 * Express has actually flushed the response, so it is correct for both
 * success and error paths uniformly.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsRegistry: MetricsRegistry) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const startTime = process.hrtime.bigint();

    response.on('finish', () => {
      const route = request.route?.path ?? request.url;
      const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
      const labels = {
        method: request.method,
        route,
        status_code: String(response.statusCode),
      };

      this.metricsRegistry.httpRequestDuration.observe(labels, durationSeconds);
      this.metricsRegistry.httpRequestsTotal.inc(labels);
    });

    return next.handle();
  }
}
