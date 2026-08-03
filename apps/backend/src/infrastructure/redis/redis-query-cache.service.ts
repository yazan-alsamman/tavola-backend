import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CACHE_CLIENT } from './redis.tokens';

export interface RedisQueryCacheCodec<T> {
  serialize(value: T): string;
  deserialize(raw: string): T;
}

// `JSON.parse` does not revive `Date` values - `JSON.stringify` turns them
// into ISO-8601 strings, and without this reviver every cached DTO field
// that was a `Date` (createdAt/updatedAt/etc.) would silently become a
// plain string on a cache hit, breaking any caller downstream that expects
// a real `Date` (e.g. `.toISOString()`).
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
function reviveDates(_key: string, value: unknown): unknown {
  return typeof value === 'string' && ISO_DATE_RE.test(value) ? new Date(value) : value;
}

const jsonCodec = <T>(): RedisQueryCacheCodec<T> => ({
  serialize: (value) => JSON.stringify(value),
  deserialize: (raw) => JSON.parse(raw, reviveDates) as T,
});

/**
 * Post-Audit Remediation (2026-08-02, L7). Generic cache-aside helper over
 * the existing `REDIS_CACHE_CLIENT` (ADR-004) - previously used only for
 * rate limiting and messaging idempotency, never for query-result caching,
 * despite Discovery's search/nearby queries and Analytics' aggregate
 * queries being the platform's canonical read-heavy surfaces. Short,
 * fixed TTLs only (no write-side invalidation) - both surfaces already
 * tolerate brief staleness by nature (a public restaurant listing, a
 * dashboard aggregate), so a TTL-only cache is the minimal, safe way to add
 * caching here without wiring invalidation hooks across the several
 * unrelated modules (Restaurants/Branches/Offers/Reviews/Reservations)
 * that can affect these read models - that wiring would be a materially
 * larger change than this remediation item calls for.
 */
@Injectable()
export class RedisQueryCache {
  constructor(@Inject(REDIS_CACHE_CLIENT) private readonly client: Redis) {}

  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    compute: () => Promise<T>,
    codec: RedisQueryCacheCodec<T> = jsonCodec<T>(),
  ): Promise<T> {
    const cached = await this.client.get(key);
    if (cached !== null) {
      return codec.deserialize(cached);
    }
    const value = await compute();
    await this.client.set(key, codec.serialize(value), 'EX', ttlSeconds);
    return value;
  }
}
