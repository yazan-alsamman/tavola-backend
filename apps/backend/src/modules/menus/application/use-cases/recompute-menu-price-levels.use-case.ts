import { Inject, Injectable } from '@nestjs/common';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import {
  MenuPriceLevelRepository,
  MENU_PRICE_LEVEL_REPOSITORY,
} from '../../domain/repositories/menu-price-level.repository';

/** ADR-046: System actor, run by the price-level queue (after menu edits, and daily). */
@Injectable()
export class RecomputeMenuPriceLevelsUseCase {
  constructor(
    @Inject(MENU_PRICE_LEVEL_REPOSITORY)
    private readonly priceLevelRepository: MenuPriceLevelRepository,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(): Promise<{ updated: number }> {
    const updated = await this.unitOfWork.execute(() => this.priceLevelRepository.recomputeAll());
    return { updated };
  }
}
