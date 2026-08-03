import { Inject, Injectable } from '@nestjs/common';
import { REDIS_CACHE_CLIENT } from '@infrastructure/redis/redis.tokens';
import type { RedisCacheClient } from '@infrastructure/redis/redis-cache.client';
import {
  IdempotencyStorePort,
  StoredIdempotentResponse,
} from '../../application/ports/idempotency-store.port';

/** DECISIONS.md D12 - reuses the same Redis cache connection `RateLimiterPort` already uses, not a new subsystem. */
@Injectable()
export class RedisIdempotencyStore implements IdempotencyStorePort {
  constructor(@Inject(REDIS_CACHE_CLIENT) private readonly redis: RedisCacheClient) {}

  async get(key: string): Promise<StoredIdempotentResponse | null> {
    const raw = await this.redis.get(key);
    if (raw === null) {
      return null;
    }
    return JSON.parse(raw) as StoredIdempotentResponse;
  }

  async save(key: string, response: StoredIdempotentResponse, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(response), 'EX', ttlSeconds);
  }
}
