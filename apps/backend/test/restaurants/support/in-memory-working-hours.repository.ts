import { WorkingHours } from '@modules/restaurants/domain/entities/working-hours.entity';
import { WorkingHoursRepository } from '@modules/restaurants/domain/repositories/working-hours.repository';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryWorkingHoursRepository implements WorkingHoursRepository {
  private readonly rowsByRestaurantId = new Map<string, WorkingHours[]>();

  async findAllByRestaurantId(restaurantId: RestaurantId): Promise<WorkingHours[]> {
    return [...(this.rowsByRestaurantId.get(restaurantId.value) ?? [])];
  }

  async findAllByRestaurantIds(restaurantIds: RestaurantId[]): Promise<WorkingHours[]> {
    return restaurantIds.flatMap((id) => [...(this.rowsByRestaurantId.get(id.value) ?? [])]);
  }

  async replaceAllForRestaurant(
    restaurantId: RestaurantId,
    entries: WorkingHours[],
  ): Promise<void> {
    this.rowsByRestaurantId.set(restaurantId.value, [...entries]);
  }
}
