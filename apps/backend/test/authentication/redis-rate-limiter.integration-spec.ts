import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { RedisSlidingWindowRateLimiter } from '@modules/authentication/infrastructure/redis/redis-sliding-window-rate-limiter';
import {
  isRedisReachable,
  resolveTestRedisUrl,
  skipUnlessDatabaseAvailable,
} from '../support/live-database';

describe('RedisSlidingWindowRateLimiter (integration, real Redis)', () => {
  let redis: Redis;
  let limiter: RedisSlidingWindowRateLimiter;
  let redisAvailable = false;

  beforeAll(async () => {
    const redisUrl = resolveTestRedisUrl();
    redis = new Redis(redisUrl, { db: 0, lazyConnect: false, maxRetriesPerRequest: 1 });
    redisAvailable = await isRedisReachable(redisUrl);
    if (skipUnlessDatabaseAvailable(redisAvailable)) {
      console.warn('Redis not reachable — skipping rate limiter integration tests.');
      return;
    }
    limiter = new RedisSlidingWindowRateLimiter(redis as never);
  });

  afterAll(async () => {
    await redis?.quit();
  });

  function uniqueKey(): string {
    return `test:ratelimit:${randomUUID()}`;
  }

  it('allows requests under the limit and decrements remaining', async () => {
    if (!redisAvailable) return;

    const key = uniqueKey();
    const now = new Date('2026-01-01T00:00:00.000Z');

    const first = await limiter.consume(key, 3, 60, now);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);

    const second = await limiter.consume(key, 3, 60, now);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);
  });

  it('blocks the request once the limit is reached, atomically', async () => {
    if (!redisAvailable) return;

    const key = uniqueKey();
    const now = new Date('2026-01-01T00:00:00.000Z');

    await limiter.consume(key, 2, 60, now);
    await limiter.consume(key, 2, 60, now);
    const third = await limiter.consume(key, 2, 60, now);

    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it('does not extend the window when requests are blocked (no counter inflation)', async () => {
    if (!redisAvailable) return;

    const key = uniqueKey();
    const now = new Date('2026-01-01T00:00:00.000Z');

    await limiter.consume(key, 1, 60, now);
    await limiter.consume(key, 1, 60, new Date(now.getTime() + 1_000));
    const blocked = await limiter.consume(key, 1, 60, new Date(now.getTime() + 2_000));

    expect(blocked.allowed).toBe(false);
    const cardinality = await redis.zcard(key);
    expect(cardinality).toBe(1);
  });

  it('resets after the window fully expires', async () => {
    if (!redisAvailable) return;

    const key = uniqueKey();
    const windowSeconds = 5;
    const start = new Date('2026-01-01T00:00:00.000Z');

    await limiter.consume(key, 1, windowSeconds, start);
    const blocked = await limiter.consume(key, 1, windowSeconds, start);
    expect(blocked.allowed).toBe(false);

    const afterWindow = new Date(start.getTime() + (windowSeconds + 1) * 1000);
    const allowedAgain = await limiter.consume(key, 1, windowSeconds, afterWindow);
    expect(allowedAgain.allowed).toBe(true);
  });

  it('keeps independent keys fully isolated from one another', async () => {
    if (!redisAvailable) return;

    const keyA = uniqueKey();
    const keyB = uniqueKey();
    const now = new Date('2026-01-01T00:00:00.000Z');

    await limiter.consume(keyA, 1, 60, now);
    const blockedA = await limiter.consume(keyA, 1, 60, now);
    const allowedB = await limiter.consume(keyB, 1, 60, now);

    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });

  it('caps concurrent bursts at exactly the configured limit (no race condition)', async () => {
    if (!redisAvailable) return;

    const key = uniqueKey();
    const now = new Date('2026-01-01T00:00:00.000Z');
    const limit = 5;
    const burstSize = 25;

    const decisions = await Promise.all(
      Array.from({ length: burstSize }, () => limiter.consume(key, limit, 60, now)),
    );

    const allowedCount = decisions.filter((decision) => decision.allowed).length;
    expect(allowedCount).toBe(limit);
  });

  it('caps concurrent bursts issued from multiple independent Redis clients (horizontal scaling)', async () => {
    if (!redisAvailable) return;

    const key = uniqueKey();
    const now = new Date('2026-01-01T00:00:00.000Z');
    const limit = 5;

    const clientA = new Redis(resolveTestRedisUrl(), { db: 0 });
    const clientB = new Redis(resolveTestRedisUrl(), { db: 0 });
    const limiterA = new RedisSlidingWindowRateLimiter(clientA as never);
    const limiterB = new RedisSlidingWindowRateLimiter(clientB as never);

    try {
      const decisions = await Promise.all([
        ...Array.from({ length: 10 }, () => limiterA.consume(key, limit, 60, now)),
        ...Array.from({ length: 10 }, () => limiterB.consume(key, limit, 60, now)),
      ]);

      const allowedCount = decisions.filter((decision) => decision.allowed).length;
      expect(allowedCount).toBe(limit);
    } finally {
      await clientA.quit();
      await clientB.quit();
    }
  });
});
