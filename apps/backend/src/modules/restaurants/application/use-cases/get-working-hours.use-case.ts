import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import {
  WorkingHoursRepository,
  WORKING_HOURS_REPOSITORY,
} from '../../domain/repositories/working-hours.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { toWorkingHoursResult } from '../mappers/working-hours-result.mapper';
import { GetWorkingHoursCommand } from '../dto/get-working-hours.command';
import { WorkingHoursResult } from '../dto/working-hours.result';

@Injectable()
export class GetWorkingHoursUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(WORKING_HOURS_REPOSITORY)
    private readonly workingHoursRepository: WorkingHoursRepository,
  ) {}

  async execute(command: GetWorkingHoursCommand): Promise<WorkingHoursResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate: WorkingHours carries no organizationId of its
    // own (TENANCY.md's "transitively tenant-owned" case, same as
    // RestaurantSettings) - resolving the parent Restaurant through the
    // already-tenant-scoped RestaurantRepository first is what makes this
    // call safe. A restaurant belonging to another organization resolves to
    // null here exactly like any other cross-tenant Restaurant lookup.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const entries = await this.workingHoursRepository.findAllByRestaurantId(restaurantId);
    return toWorkingHoursResult(restaurantId.value, entries);
  }
}
