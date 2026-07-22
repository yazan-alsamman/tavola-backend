import { DynamicModule, INestApplication, Type, VersioningType } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { json, urlencoded } from 'express';
import { AppModule } from '../../src/app.module';
import { createGlobalValidationPipe } from '../../src/common/pipes/validation-pipe.factory';

export interface ProviderOverride {
  provide: string | symbol | Type<unknown>;
  useValue: unknown;
}

/**
 * `extraModules` lets a test mount an ephemeral, test-only module (e.g. a
 * fixture controller proving a guard/decorator works) alongside the real
 * `AppModule`, without adding a throwaway route to any production
 * controller (AUTHORIZATION_ARCHITECTURE.md Phase 2.15 guidance).
 *
 * `overrides` lets a test replace a real provider (e.g. `VERIFICATION_MESSAGING`,
 * so Customer registration/password-reset e2e specs never call the real
 * Fonnte adapter) with an in-memory fake, while every other provider in the
 * real `AppModule` graph stays wired exactly as production - not a parallel
 * test-only module tree.
 */
export async function createTestApp(
  extraModules: Array<Type<unknown> | DynamicModule> = [],
  overrides: ProviderOverride[] = [],
): Promise<INestApplication> {
  let builder = Test.createTestingModule({
    imports: [AppModule, ...extraModules],
  });

  for (const override of overrides) {
    builder = builder.overrideProvider(override.provide).useValue(override.useValue);
  }

  const moduleFixture: TestingModule = await builder.compile();

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
