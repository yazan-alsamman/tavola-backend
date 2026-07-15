import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { RedisConfig } from '@config/redis.config';

/**
 * The cache-purpose Redis connection (ADR-004), isolated on its own db
 * index from the BullMQ queue connection and the Socket.IO adapter
 * connection so their throughput/observability never mix (ADR-015).
 */
@Injectable()
export class RedisCacheClient extends Redis implements OnModuleDestroy {
  constructor(configService: ConfigService) {
    const redisConfig = configService.getOrThrow<RedisConfig>('redis');
    super(redisConfig.url, { db: redisConfig.cacheDbIndex });
  }

  async onModuleDestroy(): Promise<void> {
    await this.quit();
  }
}
