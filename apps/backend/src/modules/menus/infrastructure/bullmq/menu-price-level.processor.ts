import { Processor, WorkerHost } from '@nestjs/bullmq';
import { RecomputeMenuPriceLevelsUseCase } from '../../application/use-cases/recompute-menu-price-levels.use-case';
import { MENU_PRICE_LEVEL_QUEUE_NAME } from './menu-price-level-queue.constants';

/** Sole consumer of `MenuPriceLevelQueue`; no business logic of its own. */
@Processor(MENU_PRICE_LEVEL_QUEUE_NAME)
export class MenuPriceLevelProcessor extends WorkerHost {
  constructor(private readonly recomputeMenuPriceLevels: RecomputeMenuPriceLevelsUseCase) {
    super();
  }

  async process(): Promise<{ updated: number }> {
    return this.recomputeMenuPriceLevels.execute();
  }
}
