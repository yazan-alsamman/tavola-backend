import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { RoleScope } from '@modules/authorization/domain/enums/authorization.enums';
import { RoleRepository } from '@modules/authorization/domain/repositories/authorization.repositories';
import { ROLE_REPOSITORY } from '@modules/authorization/application/tokens/authorization.tokens';
import { RoleResult } from '../dto/role.result';

/**
 * The roles an employee of this restaurant can be given (seeded,
 * restaurant-scoped). Without it the dashboard asked the owner to type a
 * role UUID by hand.
 */
@Injectable()
export class ListRestaurantRolesUseCase {
  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roleRepository: RoleRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
  ) {}

  async execute(command: { restaurantId: string }): Promise<RoleResult[]> {
    const restaurant = await this.restaurantRepository.findById(
      RestaurantId.create(command.restaurantId),
    );
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }
    const roles = await this.roleRepository.findAllByScope(RoleScope.Restaurant);
    return roles.map((role) => {
      const props = role.toProps();
      return {
        roleId: props.id,
        name: props.name,
        slug: props.slug,
        description: props.description,
      };
    });
  }
}
