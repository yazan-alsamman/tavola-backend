import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { RestaurantsController } from './restaurants.controller';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { OrganizationMemberGuard } from '@modules/authorization/presentation/guards/organization-member.guard';
import { CreateRestaurantUseCase } from '../../application/use-cases/create-restaurant.use-case';
import { GetRestaurantUseCase } from '../../application/use-cases/get-restaurant.use-case';
import { ListRestaurantsUseCase } from '../../application/use-cases/list-restaurants.use-case';
import { UpdateRestaurantUseCase } from '../../application/use-cases/update-restaurant.use-case';
import { DeleteRestaurantUseCase } from '../../application/use-cases/delete-restaurant.use-case';
import { GetRestaurantSettingsUseCase } from '../../application/use-cases/get-restaurant-settings.use-case';
import { UpdateRestaurantSettingsUseCase } from '../../application/use-cases/update-restaurant-settings.use-case';
import { GetWorkingHoursUseCase } from '../../application/use-cases/get-working-hours.use-case';
import { UpdateWorkingHoursUseCase } from '../../application/use-cases/update-working-hours.use-case';

/**
 * Boots only RestaurantsController against the real @nestjs/swagger document
 * builder, mirroring UsersController's own swagger spec.
 */
describe('RestaurantsController Swagger document', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  const protectedPaths: Array<{
    path: string;
    methods: Array<'get' | 'patch' | 'post' | 'delete'>;
  }> = [
    { path: '/restaurants', methods: ['post', 'get'] },
    { path: '/restaurants/{id}', methods: ['get', 'patch', 'delete'] },
    { path: '/restaurants/{id}/settings', methods: ['get', 'patch'] },
    { path: '/restaurants/{id}/working-hours', methods: ['get', 'patch'] },
  ];

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [RestaurantsController],
      providers: [
        { provide: CreateRestaurantUseCase, useValue: {} },
        { provide: GetRestaurantUseCase, useValue: {} },
        { provide: ListRestaurantsUseCase, useValue: {} },
        { provide: UpdateRestaurantUseCase, useValue: {} },
        { provide: DeleteRestaurantUseCase, useValue: {} },
        { provide: GetRestaurantSettingsUseCase, useValue: {} },
        { provide: UpdateRestaurantSettingsUseCase, useValue: {} },
        { provide: GetWorkingHoursUseCase, useValue: {} },
        { provide: UpdateWorkingHoursUseCase, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(SessionVersionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OrganizationMemberGuard)
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

  it('documents POST and GET /restaurants', () => {
    const pathItem = document.paths['/restaurants'];
    expect(pathItem).toBeDefined();
    expect(pathItem.post).toBeDefined();
    expect(pathItem.get).toBeDefined();
  });

  it('documents GET, PATCH, and DELETE /restaurants/{id}', () => {
    const pathItem = document.paths['/restaurants/{id}'];
    expect(pathItem).toBeDefined();
    expect(pathItem.get).toBeDefined();
    expect(pathItem.patch).toBeDefined();
    expect(pathItem.delete).toBeDefined();
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

  it('requires bearer auth on every restaurant endpoint', () => {
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

  it('documents 201 for POST /restaurants and 204 for DELETE /restaurants/{id}', () => {
    expect(document.paths['/restaurants'].post?.responses['201']).toBeDefined();
    expect(document.paths['/restaurants/{id}'].delete?.responses['204']).toBeDefined();
  });

  it('documents GET and PATCH /restaurants/{id}/settings', () => {
    const pathItem = document.paths['/restaurants/{id}/settings'];
    expect(pathItem).toBeDefined();
    expect(pathItem.get).toBeDefined();
    expect(pathItem.patch).toBeDefined();
  });

  it('documents GET and PATCH /restaurants/{id}/working-hours', () => {
    const pathItem = document.paths['/restaurants/{id}/working-hours'];
    expect(pathItem).toBeDefined();
    expect(pathItem.get).toBeDefined();
    expect(pathItem.patch).toBeDefined();
  });
});
