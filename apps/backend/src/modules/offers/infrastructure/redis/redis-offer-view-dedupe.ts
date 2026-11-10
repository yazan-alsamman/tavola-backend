import { Inject, Injectable } from '@nestjs/common';
import { REDIS_CACHE_CLIENT } from '@infrastructure/redis/redis.tokens';
import type { RedisCacheClient } from '@infrastructure/redis/redis-cache.client';
import { OfferViewDedupePort } from '../../application/ports/offer-view-dedupe.port';

const ONE_DAY_SECONDS = 24 * 60 * 60;

/** One `SET NX` per offer; the key lives a day, so memory stays bounded. */
@Injectable()
export class RedisOfferViewDedupe implements OfferViewDedupePort {
  constructor(@Inject(REDIS_CACHE_CLIENT) private readonly redis: RedisCacheClient) {}

  async claimFirstViews(offerIds: string[], viewerKey: string, now: Date): Promise<string[]> {
    if (offerIds.length === 0) {
      return [];
    }
    const day = now.toISOString().slice(0, 10);
    const pipeline = this.redis.pipeline();
    for (const offerId of offerIds) {
      pipeline.set(`offer-view:${day}:${offerId}:${viewerKey}`, '1', 'EX', ONE_DAY_SECONDS, 'NX');
    }
    const results = (await pipeline.exec()) ?? [];
    return offerIds.filter((_, index) => results[index]?.[1] === 'OK');
  }
}
