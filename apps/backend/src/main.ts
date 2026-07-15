import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { createGlobalValidationPipe } from './common/pipes/validation-pipe.factory';
import { setupSwagger } from './swagger.config';
import { RedisIoAdapter } from './infrastructure/websocket/redis-io.adapter';
import type { AppConfig } from '@config/app.config';
import type { RedisConfig } from '@config/redis.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const configService = app.get(ConfigService);
  const appConfig = configService.getOrThrow<AppConfig>('app');
  const redisConfig = configService.getOrThrow<RedisConfig>('redis');

  app.useLogger(app.get(Logger));
  app.useGlobalPipes(createGlobalValidationPipe());
  app.enableShutdownHooks();

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.disable('x-powered-by');
  expressApp.use(json({ limit: appConfig.requestBodyLimit }));
  expressApp.use(urlencoded({ extended: true, limit: appConfig.requestBodyLimit }));

  app.enableCors({ origin: appConfig.corsAllowedOrigins });
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: appConfig.apiVersion.replace(/^v/, ''),
  });

  const redisIoAdapter = new RedisIoAdapter(app);
  redisIoAdapter.connectToRedis(redisConfig.url, redisConfig.socketAdapterDbIndex);
  app.useWebSocketAdapter(redisIoAdapter);

  if (appConfig.swaggerEnabled) {
    setupSwagger(app, appConfig.apiVersion);
  }

  await app.listen(appConfig.port);
}

void bootstrap();
