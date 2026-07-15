import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { IncomingMessage, ServerResponse } from 'http';
import { PINO_REDACT_PATHS } from './pino-redact-paths';
import { resolveCorrelationId } from './correlation-id.util';
import type { LoggingConfig } from '@config/logging.config';
import type { AppConfig } from '@config/app.config';

/**
 * Correlation IDs are generated/propagated here, inside pino-http's own
 * genReqId hook, rather than in a separate Express middleware. pino-http
 * already runs earliest in the request lifecycle; introducing a second,
 * independent middleware for the same identifier would risk two different
 * IDs racing depending on registration order. This keeps correlation-ID
 * generation single-sourced - every consumer (logs, and later the Global
 * Exception Filter via request.id) reads the same value.
 *
 * Marked @Global(): PinoLogger/@InjectPinoLogger is used throughout the
 * codebase (PrismaService, GlobalExceptionFilter, and every future module),
 * and nestjs-pino's own LoggerModule is not global by default - without
 * this, every consuming module would need to import AppLoggingModule
 * explicitly, which is exactly the kind of easy-to-forget wiring this phase
 * exists to get right once.
 */
@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const logging = configService.get<LoggingConfig>('logging');
        const app = configService.get<AppConfig>('app');
        const correlationHeader = app?.correlationIdHeader ?? 'x-correlation-id';

        return {
          pinoHttp: {
            level: logging?.level ?? 'info',
            redact: {
              paths: PINO_REDACT_PATHS,
              censor: '[REDACTED]',
            },
            genReqId: (req: IncomingMessage, res: ServerResponse) => {
              const correlationId = resolveCorrelationId(req.headers[correlationHeader]);
              res.setHeader(correlationHeader, correlationId);
              return correlationId;
            },
            transport: logging?.pretty
              ? {
                  target: 'pino-pretty',
                  options: { singleLine: true, colorize: true },
                }
              : undefined,
          },
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class AppLoggingModule {}
