import { Injectable, Inject } from '@nestjs/common';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { EmployeeRepository } from '@modules/authorization/domain/repositories/authorization.repositories';
import { EMPLOYEE_REPOSITORY } from '@modules/authorization/application/tokens/authorization.tokens';
import { toEmployeeResult } from '../mappers/employee-result.mapper';
import { EmployeeResult } from '../dto/employee.result';

/**
 * The restaurant's staff list for the dashboard's Staff page, which could
 * invite employees but never read them back. The restaurant lookup is
 * tenant-scoped, so another organization's restaurant is a 404.
 */
@Injectable()
export class ListRestaurantEmployeesUseCase {
  constructor(
    @Inject(EMPLOYEE_REPOSITORY) private readonly employeeRepository: EmployeeRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
  ) {}

  async execute(command: { restaurantId: string }): Promise<EmployeeResult[]> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }
    const employees = await this.employeeRepository.findAllByRestaurantId(restaurantId);
    return employees.map(toEmployeeResult);
  }
}
