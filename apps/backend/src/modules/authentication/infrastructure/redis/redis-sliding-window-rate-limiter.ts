import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { REDIS_CACHE_CLIENT } from '@infrastructure/redis/redis.tokens';
import type { RedisCacheClient } from '@infrastructure/redis/redis-cache.client';
import { RateLimitDecision, RateLimiterPort } from '../../domain/services/rate-limiter.port';

/**
 * Sliding-window-log algorithm (AUTHENTICATION_ARCHITECTURE.md §8.2: "Redis
 * sliding window on `login` endpoint") implemented as a single atomic Lua
 * script - the whole read-check-write sequence runs as one Redis command, so
 * concurrent requests across any number of application instances can never
 * race past the limit (Redis executes scripts single-threaded). No counter
 * or timer state is kept outside Redis, satisfying horizontal scaling.
 *
 * Each request is a member of a per-key sorted set, scored by its arrival
 * time in milliseconds. Expired members (older than the window) are trimmed
 * before counting, so the window slides continuously rather than resetting
 * on fixed boundaries (avoiding the classic fixed-window edge-burst problem).
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - windowMs)
local count = redis.call('ZCARD', key)

local allowed = 0
if count < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, windowMs)
  count = count + 1
  allowed = 1
end

local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local oldestScore = now
if oldest[2] ~= nil then
  oldestScore = tonumber(oldest[2])
end

return {allowed, count, oldestScore}
`;

@Injectable()
export class RedisSlidingWindowRateLimiter implements RateLimiterPort {
  constructor(@Inject(REDIS_CACHE_CLIENT) private readonly redis: RedisCacheClient) {}

  async consume(
    key: string,
    limit: number,
    windowSeconds: number,
    now: Date,
  ): Promise<RateLimitDecision> {
    const nowMs = now.getTime();
    const windowMs = windowSeconds * 1000;
    const member = `${nowMs}-${randomUUID()}`;

    const result = (await this.redis.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      key,
      nowMs,
      windowMs,
      limit,
      member,
    )) as [number, number, number];

    const [allowedFlag, count, oldestScore] = result;

    return {
      allowed: allowedFlag === 1,
      remaining: Math.max(0, limit - count),
      resetAt: new Date(oldestScore + windowMs),
    };
  }
}
