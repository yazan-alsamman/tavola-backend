import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { MenuRepository, MENU_REPOSITORY } from '../../domain/repositories/menu.repository';

export interface ListRestaurantIdsWithMenuCommand {
  restaurantIds: string[];
}

/**
 * ADR-031 decision #9: backs `Restaurant.hasMenu` for Discovery
 * (`ListDiscoverableRestaurantsUseCase`/`NearbyRestaurantsUseCase`/
 * `CompareRestaurantsUseCase`), mirroring
 * `ListRestaurantIdsWithActiveOfferUseCase`'s exact composition pattern -
 * exported from `MenusModule` so Discovery never duplicates Menu business
 * logic.
 */
@Injectable()
export class ListRestaurantIdsWithMenuUseCase {
  constructor(@Inject(MENU_REPOSITORY) private readonly menuRepository: MenuRepository) {}

  async execute(command: ListRestaurantIdsWithMenuCommand): Promise<Set<string>> {
    return this.menuRepository.findRestaurantIdsWithActiveDefaultMenu(
      command.restaurantIds.map((id) => RestaurantId.create(id)),
    );
  }
}
