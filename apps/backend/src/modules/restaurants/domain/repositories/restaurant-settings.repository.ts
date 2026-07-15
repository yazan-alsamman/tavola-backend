import { RestaurantSettings } from '../entities/restaurant-settings.entity';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * No `organizationId` parameter, same reasoning as `RestaurantRepository`,
 * but for a different reason: `RestaurantSettings` is NOT in
 * `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (it carries no direct
 * `organizationId` column - see the Prisma schema's own comment on this
 * model). Tenant isolation is instead the CALLER's responsibility: every use
 * case must resolve the parent `Restaurant` via the already-tenant-scoped
 * `RestaurantRepository` first, and only call this repository's methods
 * after that succeeds. This repository alone provides no isolation
 * guarantee - see `PrismaRestaurantSettingsRepository`'s own doc comment.
 */
export interface RestaurantSettingsRepository {
  findByRestaurantId(restaurantId: RestaurantId): Promise<RestaurantSettings | null>;
  save(settings: RestaurantSettings): Promise<void>;
}

export const RESTAURANT_SETTINGS_REPOSITORY = Symbol('RESTAURANT_SETTINGS_REPOSITORY');
