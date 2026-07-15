import { DynamicModule, INestApplication, Type, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import { AppModule } from '../../src/app.module';
import { createGlobalValidationPipe } from '../../src/common/pipes/validation-pipe.factory';

/**
 * `extraModules` lets a test mount an ephemeral, test-only module (e.g. a
 * fixture controller proving a guard/decorator works) alongside the real
 * `AppModule`, without adding a throwaway route to any production
 * controller (AUTHORIZATION_ARCHITECTURE.md Phase 2.15 guidance).
 */
export async function createTestApp(
  extraModules: Array<Type<unknown> | DynamicModule> = [],
): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule, ...extraModules],
  }).compile();

  const app = moduleFixture.createNestApplication({ bufferLogs: true });
  app.useGlobalPipes(createGlobalValidationPipe());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.disable('x-powered-by');
  expressApp.use(json({ limit: '10mb' }));
  expressApp.use(urlencoded({ extended: true, limit: '10mb' }));

  await app.init();
  return app;
}
