import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisCacheClient } from './redis-cache.client';
import { RedisQueryCache } from './redis-query-cache.service';
import { REDIS_CACHE_CLIENT } from './redis.tokens';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    RedisCacheClient,
    { provide: REDIS_CACHE_CLIENT, useExisting: RedisCacheClient },
    RedisQueryCache,
  ],
  exports: [REDIS_CACHE_CLIENT, RedisCacheClient, RedisQueryCache],
})
export class RedisModule {}
