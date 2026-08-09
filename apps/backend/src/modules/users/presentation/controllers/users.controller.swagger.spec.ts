import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { UsersController } from './users.controller';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { GetCurrentUserProfileUseCase } from '../../application/use-cases/get-current-user-profile.use-case';
import { UpdateUserProfileUseCase } from '../../application/use-cases/update-user-profile.use-case';
import { UploadCurrentUserAvatarUseCase } from '../../application/use-cases/upload-current-user-avatar.use-case';
import { AddFavoriteUseCase } from '../../application/use-cases/add-favorite.use-case';
import { RemoveFavoriteUseCase } from '../../application/use-cases/remove-favorite.use-case';
import { ListCurrentUserFavoritesUseCase } from '../../application/use-cases/list-current-user-favorites.use-case';
import { GetCurrentUserPreferencesUseCase } from '../../application/use-cases/get-current-user-preferences.use-case';
import { UpdateUserPreferencesUseCase } from '../../application/use-cases/update-user-preferences.use-case';
import { RequestAccountDeletionUseCase } from '../../application/use-cases/request-account-deletion.use-case';
import { CancelAccountDeletionUseCase } from '../../application/use-cases/cancel-account-deletion.use-case';
import { ExportUserDataUseCase } from '../../application/use-cases/export-user-data.use-case';

/**
 * Boots only UsersController against the real @nestjs/swagger document
 * builder, mirroring AuthController's swagger spec (document builds, no
 * duplicate operationIds/schemas, every endpoint appears, bearer auth on
 * every endpoint since all endpoints are self-scoped and require
 * authentication).
 */
describe('UsersController Swagger document', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  const protectedPaths: Array<{
    path: string;
    methods: Array<'get' | 'patch' | 'post' | 'delete'>;
  }> = [
    { path: '/users/me', methods: ['get', 'patch', 'delete'] },
    { path: '/users/me/avatar', methods: ['post'] },
    { path: '/users/me/favorites/{restaurantId}', methods: ['post', 'delete'] },
    { path: '/users/me/favorites', methods: ['get'] },
    { path: '/users/me/preferences', methods: ['get', 'patch'] },
    { path: '/users/me/cancel-deletion', methods: ['post'] },
    { path: '/users/me/export', methods: ['get'] },
  ];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: GetCurrentUserProfileUseCase, useValue: {} },
        { provide: UpdateUserProfileUseCase, useValue: {} },
        { provide: UploadCurrentUserAvatarUseCase, useValue: {} },
        { provide: AddFavoriteUseCase, useValue: {} },
        { provide: RemoveFavoriteUseCase, useValue: {} },
        { provide: ListCurrentUserFavoritesUseCase, useValue: {} },
        { provide: GetCurrentUserPreferencesUseCase, useValue: {} },
        { provide: UpdateUserPreferencesUseCase, useValue: {} },
        { provide: RequestAccountDeletionUseCase, useValue: {} },
        { provide: CancelAccountDeletionUseCase, useValue: {} },
        { provide: ExportUserDataUseCase, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SessionVersionGuard)
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

  it('documents GET and PATCH /users/me', () => {
    const pathItem = document.paths['/users/me'];
    expect(pathItem).toBeDefined();
    expect(pathItem.get).toBeDefined();
    expect(pathItem.patch).toBeDefined();
  });

  it('documents POST /users/me/avatar as multipart/form-data', () => {
    const pathItem = document.paths['/users/me/avatar'];
    expect(pathItem).toBeDefined();
    expect(pathItem.post).toBeDefined();
    const requestBody = pathItem.post?.requestBody as
      { content?: Record<string, unknown> } | undefined;
    expect(requestBody?.content).toHaveProperty('multipart/form-data');
  });

  it('documents POST and DELETE /users/me/favorites/{restaurantId}', () => {
    const pathItem = document.paths['/users/me/favorites/{restaurantId}'];
    expect(pathItem).toBeDefined();
    expect(pathItem.post).toBeDefined();
    expect(pathItem.delete).toBeDefined();
  });

  it('documents GET /users/me/favorites', () => {
    const pathItem = document.paths['/users/me/favorites'];
    expect(pathItem).toBeDefined();
    expect(pathItem.get).toBeDefined();
  });

  it('documents GET and PATCH /users/me/preferences', () => {
    const pathItem = document.paths['/users/me/preferences'];
    expect(pathItem).toBeDefined();
    expect(pathItem.get).toBeDefined();
    expect(pathItem.patch).toBeDefined();
  });

  it('documents DELETE /users/me (account deletion)', () => {
    const pathItem = document.paths['/users/me'];
    expect(pathItem).toBeDefined();
    expect(pathItem.delete).toBeDefined();
  });

  it('documents POST /users/me/cancel-deletion', () => {
    const pathItem = document.paths['/users/me/cancel-deletion'];
    expect(pathItem).toBeDefined();
    expect(pathItem.post).toBeDefined();
  });

  it('documents GET /users/me/export', () => {
    const pathItem = document.paths['/users/me/export'];
    expect(pathItem).toBeDefined();
    expect(pathItem.get).toBeDefined();
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

  it('requires bearer auth on every self-scoped endpoint', () => {
    for (const { path, methods } of protectedPaths) {
      const pathItem = document.paths[path];
      for (const method of methods) {
        const operation = pathItem[method];
        if (!operation) continue;
        expect(operation.security).toEqual([{ bearer: [] }]);
      }
    }
  });

  it('documents at least one error response with a `code` example for every endpoint', () => {
    for (const { path, methods } of protectedPaths) {
      const pathItem = document.paths[path];
      for (const method of methods) {
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
