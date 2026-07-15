import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './helpers/test-app.factory';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from './support/live-database';

const prisma = new PrismaClient();

describe('Phase 1 infrastructure (e2e)', () => {
  let app: INestApplication | undefined;
  let stackAvailable = false;

  beforeAll(async () => {
    stackAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(stackAvailable)) {
      console.warn(
        'PostgreSQL not reachable — skipping e2e tests. Start Docker stack per ENVIRONMENT_SETUP.md.',
      );
      return;
    }

    app = await createTestApp();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await prisma.$disconnect();
  }, 30_000);

  it('returns correlation IDs on responses', async () => {
    if (!stackAvailable || !app) {
      return;
    }
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/liveness')
      .set('x-correlation-id', 'phase1-correlation-id')
      .expect(200);

    expect(response.headers['x-correlation-id']).toBe('phase1-correlation-id');
  });

  it('replaces unsafe correlation IDs with a generated value', async () => {
    if (!stackAvailable || !app) {
      return;
    }

    const response = await request(app.getHttpServer())
      .get('/api/v1/health/liveness')
      .set('x-correlation-id', 'bad/injection')
      .expect(200);

    expect(response.headers['x-correlation-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('exposes liveness without dependency checks', async () => {
    if (!stackAvailable || !app) {
      return;
    }

    const response = await request(app.getHttpServer()).get('/api/v1/health/liveness').expect(200);

    expect(response.body).toEqual({ status: 'ok', info: {}, details: {}, error: {} });
  });

  it('exposes readiness with dependency details', async () => {
    if (!stackAvailable || !app) {
      return;
    }

    const response = await request(app.getHttpServer()).get('/api/v1/health/readiness');

    expect(response.body).toHaveProperty('status');
    expect(response.body).toHaveProperty('details');
  });

  it('returns Prometheus metrics outside the JSON envelope', async () => {
    if (!stackAvailable || !app) {
      return;
    }

    const response = await request(app.getHttpServer()).get('/api/v1/metrics').expect(200);

    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('process_cpu');
    expect(typeof response.text).toBe('string');
  });

  it('returns NOT_FOUND for unknown routes via the standard error envelope', async () => {
    if (!stackAvailable || !app) {
      return;
    }

    const response = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);

    expect(response.body).toEqual(
      expect.objectContaining({
        success: false,
        code: 'NOT_FOUND',
        path: '/api/v1/does-not-exist',
      }),
    );
  });
});
