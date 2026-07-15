import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisCacheClient } from './redis-cache.client';
import { REDIS_CACHE_CLIENT } from './redis.tokens';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [RedisCacheClient, { provide: REDIS_CACHE_CLIENT, useExisting: RedisCacheClient }],
  exports: [REDIS_CACHE_CLIENT, RedisCacheClient],
})
export class RedisModule {}
