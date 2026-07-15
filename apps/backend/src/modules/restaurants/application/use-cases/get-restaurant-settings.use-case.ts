import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import {
  RestaurantSettingsRepository,
  RESTAURANT_SETTINGS_REPOSITORY,
} from '../../domain/repositories/restaurant-settings.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { toRestaurantSettingsResult } from '../mappers/restaurant-settings-result.mapper';
import { GetRestaurantSettingsCommand } from '../dto/get-restaurant-settings.command';
import { RestaurantSettingsResult } from '../dto/restaurant-settings.result';

@Injectable()
export class GetRestaurantSettingsUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESTAURANT_SETTINGS_REPOSITORY)
    private readonly restaurantSettingsRepository: RestaurantSettingsRepository,
  ) {}

  async execute(command: GetRestaurantSettingsCommand): Promise<RestaurantSettingsResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate: RestaurantSettings carries no organizationId of
    // its own (TENANCY.md's "transitively tenant-owned" case) - resolving
    // the parent Restaurant through the already-tenant-scoped
    // RestaurantRepository first is what makes this call safe. A restaurant
    // belonging to another organization resolves to null here exactly like
    // any other cross-tenant Restaurant lookup.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const settings = await this.restaurantSettingsRepository.findByRestaurantId(restaurantId);
    if (settings === null) {
      throw new RestaurantNotFoundException();
    }

    return toRestaurantSettingsResult(settings);
  }
}
