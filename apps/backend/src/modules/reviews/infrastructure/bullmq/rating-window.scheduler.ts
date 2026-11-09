import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  RATING_WINDOW_CRON,
  RATING_WINDOW_JOB_NAME,
  RATING_WINDOW_QUEUE_NAME,
  RATING_WINDOW_SCHEDULER_ID,
} from './rating-window-queue.constants';

/** Registers the daily rating-window sweep once the app is up (idempotent by scheduler id). */
@Injectable()
export class RatingWindowScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(RATING_WINDOW_QUEUE_NAME) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      RATING_WINDOW_SCHEDULER_ID,
      { pattern: RATING_WINDOW_CRON, tz: 'UTC' },
      { name: RATING_WINDOW_JOB_NAME, opts: { removeOnComplete: true, removeOnFail: 50 } },
    );
  }
}
