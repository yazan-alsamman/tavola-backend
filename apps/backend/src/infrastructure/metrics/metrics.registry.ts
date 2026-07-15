import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * NON_FUNCTIONAL_REQUIREMENTS.md's Observability section requires a metrics
 * endpoint exposing process/node metrics and per-route HTTP metrics. A
 * dedicated Registry (rather than prom-client's implicit global default
 * registry) keeps this app's metrics isolated and testable.
 */
@Injectable()
export class MetricsRegistry implements OnModuleDestroy {
  public readonly registry = new Registry();

  public readonly httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
    registers: [this.registry],
  });

  public readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [this.registry],
  });

  constructor() {
    // Process + Node.js runtime metrics: CPU, memory, event loop lag, GC,
    // active handles/requests - everything NON_FUNCTIONAL_REQUIREMENTS.md
    // groups under "process/node metrics".
    collectDefaultMetrics({ register: this.registry });
  }

  onModuleDestroy(): void {
    this.registry.clear();
  }
}
