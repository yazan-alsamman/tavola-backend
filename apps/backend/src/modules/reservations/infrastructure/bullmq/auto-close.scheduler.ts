import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  AUTO_CLOSE_EVERY_MS,
  AUTO_CLOSE_JOB_NAME,
  AUTO_CLOSE_QUEUE_NAME,
  AUTO_CLOSE_SCHEDULER_ID,
} from './auto-close-queue.constants';

/**
 * Registers the recurring auto-close sweep once the app is up.
 * `upsertJobScheduler` is idempotent by scheduler id, so every boot (and
 * every instance) converges on the same single schedule.
 */
@Injectable()
export class AutoCloseScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(AUTO_CLOSE_QUEUE_NAME) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      AUTO_CLOSE_SCHEDULER_ID,
      { every: AUTO_CLOSE_EVERY_MS },
      { name: AUTO_CLOSE_JOB_NAME, opts: { removeOnComplete: true, removeOnFail: 50 } },
    );
  }
}
