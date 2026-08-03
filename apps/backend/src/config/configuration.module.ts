import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import appConfig from './app.config';
import databaseConfig from './database.config';
import redisConfig from './redis.config';
import storageConfig from './storage.config';
import loggingConfig from './logging.config';
import authConfig from './auth.config';
import lightotpConfig from './lightotp.config';
import platformAdminAuthConfig from './platform-admin-auth.config';
import realtimeConfig from './realtime.config';
import onesignalConfig from './onesignal.config';
import discoveryConfig from './discovery.config';
import messagingConfig from './messaging.config';
import { envValidationSchema } from './env.validation';

const nodeEnv = process.env.NODE_ENV ?? 'development';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Inside Docker Compose, variables already arrive via the container's
      // `environment:` block (real process.env) - dotenv never overrides an
      // already-set variable, so loading the matching file here is a no-op
      // there and only matters when running the app directly on a host
      // without Docker (`pnpm start:dev`).
      envFilePath: [`.env.${nodeEnv}`],
      load: [
        appConfig,
        databaseConfig,
        redisConfig,
        storageConfig,
        loggingConfig,
        authConfig,
        lightotpConfig,
        platformAdminAuthConfig,
        realtimeConfig,
        onesignalConfig,
        discoveryConfig,
        messagingConfig,
      ],
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
  ],
})
export class ConfigurationModule {}
