import { WorkingHours } from '../entities/working-hours.entity';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * No `organizationId` parameter, same reasoning as `RestaurantSettingsRepository`:
 * `WorkingHours` is NOT in `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS`
 * (it carries no direct `organizationId` column - see the Prisma schema's own
 * comment on this model). Tenant isolation is instead the CALLER's
 * responsibility: every use case must resolve the parent `Restaurant` via the
 * already-tenant-scoped `RestaurantRepository` first, and only call this
 * repository's methods after that succeeds.
 */
export interface WorkingHoursRepository {
  findAllByRestaurantId(restaurantId: RestaurantId): Promise<WorkingHours[]>;
  /** Batched lookup across many restaurants in one query - avoids N+1 (see `ListWorkingHoursByRestaurantIdsUseCase`). */
  findAllByRestaurantIds(restaurantIds: RestaurantId[]): Promise<WorkingHours[]>;
  replaceAllForRestaurant(restaurantId: RestaurantId, entries: WorkingHours[]): Promise<void>;
}

export const WORKING_HOURS_REPOSITORY = Symbol('WORKING_HOURS_REPOSITORY');
