import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MenuPriceLevelSchedulerPort } from '../../application/ports/menu-price-level-scheduler.port';
import {
  MENU_PRICE_LEVEL_CRON,
  MENU_PRICE_LEVEL_DEBOUNCE_MS,
  MENU_PRICE_LEVEL_JOB_NAME,
  MENU_PRICE_LEVEL_PENDING_JOB_ID,
  MENU_PRICE_LEVEL_QUEUE_NAME,
  MENU_PRICE_LEVEL_SCHEDULER_ID,
} from './menu-price-level-queue.constants';

/**
 * Registers the daily sweep at boot (idempotent by scheduler id) and queues
 * a debounced run after each menu edit. BullMQ ignores an add whose job id
 * is still waiting, so a burst of edits costs one run.
 */
@Injectable()
export class MenuPriceLevelScheduler
  implements MenuPriceLevelSchedulerPort, OnApplicationBootstrap
{
  private readonly logger = new Logger(MenuPriceLevelScheduler.name);

  constructor(@InjectQueue(MENU_PRICE_LEVEL_QUEUE_NAME) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      MENU_PRICE_LEVEL_SCHEDULER_ID,
      { pattern: MENU_PRICE_LEVEL_CRON, tz: 'UTC' },
      { name: MENU_PRICE_LEVEL_JOB_NAME, opts: { removeOnComplete: true, removeOnFail: 50 } },
    );
  }

  async requestRecompute(): Promise<void> {
    try {
      await this.queue.add(
        MENU_PRICE_LEVEL_JOB_NAME,
        {},
        {
          jobId: MENU_PRICE_LEVEL_PENDING_JOB_ID,
          delay: MENU_PRICE_LEVEL_DEBOUNCE_MS,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (error) {
      this.logger.warn(`Could not queue a price-level recompute: ${(error as Error).message}`);
    }
  }
}
