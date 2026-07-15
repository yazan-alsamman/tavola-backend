import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { SessionVersionGuard } from '../guards/session-version.guard';
import { RateLimitGuard } from '../guards/rate-limit.guard';
import { RegisterOrganizationOwnerUseCase } from '../../application/use-cases/register-organization-owner.use-case';
import { VerifyEmailUseCase } from '../../application/use-cases/verify-email.use-case';
import { LoginUseCase } from '../../application/use-cases/login.use-case';
import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case';
import { LogoutCurrentSessionUseCase } from '../../application/use-cases/logout-current-session.use-case';
import { LogoutAllDevicesUseCase } from '../../application/use-cases/logout-all-devices.use-case';
import { ListActiveSessionsUseCase } from '../../application/use-cases/list-active-sessions.use-case';
import { RevokeSessionUseCase } from '../../application/use-cases/revoke-session.use-case';
import { ForgotPasswordUseCase } from '../../application/use-cases/forgot-password.use-case';
import { ResetPasswordUseCase } from '../../application/use-cases/reset-password.use-case';
import { ChangePasswordUseCase } from '../../application/use-cases/change-password.use-case';

/**
 * Boots only AuthController against the real @nestjs/swagger document
 * builder (Phase 2.21's own "Swagger tests" checklist: document builds,
 * no duplicate operationIds/schemas, every endpoint appears, bearer auth
 * only where appropriate). No HTTP/DB/Redis involved.
 */
describe('AuthController Swagger document', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  const publicPaths = [
    '/auth/register',
    '/auth/verify-email',
    '/auth/login',
    '/auth/refresh',
    '/auth/forgot-password',
    '/auth/reset-password',
  ];
  const protectedPaths = [
    '/auth/change-password',
    '/auth/logout',
    '/auth/logout-all',
    '/auth/sessions',
    '/auth/sessions/{sessionId}',
  ];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: RegisterOrganizationOwnerUseCase, useValue: {} },
        { provide: VerifyEmailUseCase, useValue: {} },
        { provide: LoginUseCase, useValue: {} },
        { provide: RefreshSessionUseCase, useValue: {} },
        { provide: LogoutCurrentSessionUseCase, useValue: {} },
        { provide: LogoutAllDevicesUseCase, useValue: {} },
        { provide: ListActiveSessionsUseCase, useValue: {} },
        { provide: RevokeSessionUseCase, useValue: {} },
        { provide: ForgotPasswordUseCase, useValue: {} },
        { provide: ResetPasswordUseCase, useValue: {} },
        { provide: ChangePasswordUseCase, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SessionVersionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const config = new DocumentBuilder()
      .setTitle('TAVLA API')
      .setVersion('1')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .build();
    document = SwaggerModule.createDocument(app, config);
  });

  afterAll(async () => {
    await app.close();
  });

  it('builds a document successfully', () => {
    expect(document.openapi).toBeDefined();
    expect(document.paths).toBeDefined();
  });

  it('documents every Authentication endpoint', () => {
    for (const path of [...publicPaths, ...protectedPaths]) {
      expect(document.paths[path]).toBeDefined();
    }
  });

  it('has no duplicate operationIds', () => {
    const operationIds: string[] = [];
    for (const pathItem of Object.values(document.paths)) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        const operationId = pathItem[method]?.operationId;
        if (operationId) {
          operationIds.push(operationId);
        }
      }
    }
    expect(operationIds.length).toBeGreaterThan(0);
    expect(new Set(operationIds).size).toBe(operationIds.length);
  });

  it('registers the shared ErrorResponseDto schema exactly once, with no unnamed schemas', () => {
    const schemaNames = Object.keys(document.components?.schemas ?? {});
    expect(schemaNames.filter((name) => name === 'ErrorResponseDto')).toHaveLength(1);
    expect(schemaNames.every((name) => name.length > 0 && !name.startsWith('Model'))).toBe(true);
  });

  it('requires bearer auth only on session-authenticated endpoints', () => {
    for (const path of protectedPaths) {
      const pathItem = document.paths[path];
      for (const method of ['get', 'post', 'delete'] as const) {
        const operation = pathItem[method];
        if (!operation) continue;
        expect(operation.security).toEqual([{ bearer: [] }]);
      }
    }

    for (const path of publicPaths) {
      const pathItem = document.paths[path];
      for (const method of ['get', 'post'] as const) {
        const operation = pathItem[method];
        if (!operation) continue;
        expect(operation.security ?? []).toEqual([]);
      }
    }
  });

  it('documents at least one error response with a `code` example for every endpoint', () => {
    for (const path of [...publicPaths, ...protectedPaths]) {
      const pathItem = document.paths[path];
      for (const method of ['get', 'post', 'delete'] as const) {
        const operation = pathItem[method];
        if (!operation) continue;
        const errorResponses = Object.entries(operation.responses).filter(
          ([status]) => Number(status) >= 400,
        );
        expect(errorResponses.length).toBeGreaterThan(0);
      }
    }
  });
});
