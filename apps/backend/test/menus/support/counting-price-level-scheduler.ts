import { MenuPriceLevelSchedulerPort } from '@modules/menus/application/ports/menu-price-level-scheduler.port';

/** Test double: counts recompute requests instead of queueing them. */
export class CountingPriceLevelScheduler implements MenuPriceLevelSchedulerPort {
  requests = 0;

  async requestRecompute(): Promise<void> {
    this.requests += 1;
  }
}
