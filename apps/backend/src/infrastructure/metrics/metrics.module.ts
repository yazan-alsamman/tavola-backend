import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsController } from './metrics.controller';
import { MetricsRegistry } from './metrics.registry';
import { MetricsInterceptor } from './metrics.interceptor';

@Module({
  controllers: [MetricsController],
  providers: [MetricsRegistry, { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
  exports: [MetricsRegistry],
})
export class MetricsModule {}
