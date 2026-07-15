import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { RedisConfig } from '@config/redis.config';

/**
 * Registers only the shared BullMQ connection (ADR-005), isolated on its
 * own Redis db index. The seven named queues from EVENTS.md
 * (NotificationQueue, ReservationQueue, ReminderQueue, AnalyticsQueue,
 * CleanupQueue, ReportQueue, BackupQueue) are registered by their owning
 * feature modules via BullModule.registerQueue({ name }) - none exist yet,
 * since no business module has been implemented.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redisConfig = configService.getOrThrow<RedisConfig>('redis');
        const parsedUrl = new URL(redisConfig.url);

        return {
          connection: {
            host: parsedUrl.hostname,
            port: Number(parsedUrl.port || 6379),
            password: parsedUrl.password || undefined,
            db: redisConfig.queueDbIndex,
          },
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
