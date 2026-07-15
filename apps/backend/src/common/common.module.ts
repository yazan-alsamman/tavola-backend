import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { ResponseEnvelopeInterceptor } from './interceptors/response-envelope.interceptor';

/**
 * Registers the cross-cutting request-lifecycle providers globally via the
 * APP_FILTER/APP_INTERCEPTOR DI tokens (rather than `app.useGlobalFilters()`
 * in main.ts) so both classes receive constructor-injected dependencies
 * (PinoLogger, Reflector) through Nest's own container instead of being
 * manually instantiated.
 */
@Module({
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
  ],
})
export class CommonModule {}
