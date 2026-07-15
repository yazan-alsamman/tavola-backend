import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { Client as MinioClient } from 'minio';

const DEFAULT_TEST_DATABASE_URL =
  'postgresql://tavla:tavla_test_password@localhost:5433/tavla_test?schema=public&connection_limit=5';
const DEFAULT_TEST_REDIS_URL = 'redis://:tavla_test_redis_password@localhost:6379';
const DEFAULT_DEV_REDIS_URL = 'redis://:tavla_dev_redis_password@localhost:6379';

export function isLiveDatabaseRequired(): boolean {
  return process.env.REQUIRE_LIVE_DATABASE === 'true';
}

export function resolveTestDatabaseUrl(): string {
  if (isLiveDatabaseRequired()) {
    return process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  }

  return (
    process.env.DATABASE_URL ??
    'postgresql://tavla:tavla_dev_password@localhost:5433/tavla_dev?schema=public&connection_limit=5'
  );
}

export async function isDatabaseReachable(databaseUrl?: string): Promise<boolean> {
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl ?? resolveTestDatabaseUrl(),
      },
    },
  });

  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

export function resolveTestRedisUrl(): string {
  if (isLiveDatabaseRequired()) {
    return process.env.REDIS_URL ?? DEFAULT_TEST_REDIS_URL;
  }

  return process.env.REDIS_URL ?? DEFAULT_DEV_REDIS_URL;
}

export async function isRedisReachable(redisUrl?: string): Promise<boolean> {
  const client = new Redis(redisUrl ?? resolveTestRedisUrl(), {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

interface TestMinioConfig {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
}

export function resolveTestMinioConfig(): TestMinioConfig {
  return {
    endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY ?? '',
    secretKey: process.env.MINIO_SECRET_KEY ?? '',
  };
}

// Phase 3.2 (Avatar Upload) is the first MinIO-dependent test surface - no
// reachability helper for it existed alongside isDatabaseReachable /
// isRedisReachable above. Mirrors both exactly, so strict mode fails closed
// for MinIO the same way it already does for PostgreSQL/Redis instead of
// silently skipping MinIO-backed assertions.
export async function isMinioReachable(): Promise<boolean> {
  const config = resolveTestMinioConfig();
  if (config.accessKey.length === 0 || config.secretKey.length === 0) {
    return false;
  }

  const client = new MinioClient(config);

  try {
    await client.listBuckets();
    return true;
  } catch {
    return false;
  }
}

export async function ensureMinioAvailable(): Promise<boolean> {
  const reachable = await isMinioReachable();
  if (isLiveDatabaseRequired() && !reachable) {
    throw new Error(
      'REQUIRE_LIVE_DATABASE=true but MinIO is not reachable at the configured MINIO_ENDPOINT/MINIO_PORT. Start Docker per docs/ENVIRONMENT_SETUP.md.',
    );
  }

  return reachable;
}

export async function ensureDatabaseAvailable(): Promise<boolean> {
  const url = resolveTestDatabaseUrl();
  process.env.DATABASE_URL = url;

  const reachable = await isDatabaseReachable(url);
  if (isLiveDatabaseRequired() && !reachable) {
    throw new Error(
      'REQUIRE_LIVE_DATABASE=true but PostgreSQL is not reachable at the configured DATABASE_URL. Start Docker per docs/ENVIRONMENT_SETUP.md.',
    );
  }

  return reachable;
}

// Infra-generic despite the name: pass any single reachability boolean
// (Postgres, Redis, or a combined `dbAvailable && redisAvailable`) - the
// strict/non-strict decision doesn't depend on which infrastructure it is.
export function skipUnlessDatabaseAvailable(available: boolean): boolean {
  if (available) {
    return false;
  }

  if (isLiveDatabaseRequired()) {
    throw new Error('Database-backed test reached without availability in strict mode.');
  }

  return true;
}
