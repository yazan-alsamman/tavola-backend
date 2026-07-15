import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipResponseEnvelope } from '../../common/decorators/skip-response-envelope.decorator';
import { MetricsRegistry } from './metrics.registry';

/**
 * Prometheus scrapes this as plain text exposition format, never JSON - it
 * must never pass through ResponseEnvelopeInterceptor. Excluded from
 * Swagger since it isn't a business API endpoint and doesn't return JSON.
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsRegistry: MetricsRegistry) {}

  @Get()
  @SkipResponseEnvelope()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    return this.metricsRegistry.registry.metrics();
  }
}
