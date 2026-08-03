import { Menu } from '../entities/menu.entity';
import { MenuId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * `Menu` carries no `organizationId` column and is not in
 * `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` (TENANCY.md, Phase 18) -
 * tenant resolution for management operations is transitive via
 * `Menu.restaurantId -> Restaurant.organizationId`, resolved by the calling
 * use case through the already-tenant-scoped `RestaurantRepository` first,
 * exactly like `Offer`/`Review`. Every lookup excludes soft-deleted rows.
 */
export interface MenuRepository {
  create(menu: Menu): Promise<void>;

  findByIdAndRestaurantId(id: MenuId, restaurantId: RestaurantId): Promise<Menu | null>;

  /** All non-deleted Menus for a Restaurant, ordered by `displayOrder` then `createdAt` - both the management list and the Customer public list. */
  findManyByRestaurantId(restaurantId: RestaurantId): Promise<Menu[]>;

  /** The single active, non-deleted, `isDefault` Menu - backs `Restaurant.hasMenu` and the Customer "the menu" default read (ADR-032). */
  findDefaultByRestaurantId(restaurantId: RestaurantId): Promise<Menu | null>;

  /** True iff the Restaurant already owns at least one non-deleted Menu - used to decide whether a newly-created Menu is auto-marked `isDefault`. */
  existsAnyForRestaurant(restaurantId: RestaurantId): Promise<boolean>;

  /** Persists active/isDefault/displayOrder/updatedAt - full-row update of the mutable fields. */
  update(menu: Menu): Promise<void>;

  /**
   * ADR-032 decision #1: atomically unmarks whichever Menu previously held
   * `isDefault = true` for this Restaurant (if any) and marks `menuId` as
   * the new default, in a single transaction - the partial unique index
   * `menus_restaurant_one_default_key` is the ultimate guard, but this
   * method's own transaction is what keeps the "unset old, set new" pair
   * atomic against a concurrent second Set-Default call.
   */
  setAsDefault(menuId: MenuId, restaurantId: RestaurantId, at: Date): Promise<void>;

  /** Soft delete (ADR-010) - a no-op (silently 0 rows affected) if already deleted. */
  softDelete(id: MenuId, at: Date): Promise<void>;

  /**
   * ADR-031 decision #9: bulk form of `findDefaultByRestaurantId`'s
   * existence predicate, grouped by restaurant - lets Discovery annotate
   * `hasMenu` on a whole result page in one query instead of one lookup per
   * restaurant (N+1), mirroring `OfferRepository.findRestaurantIdsWithActivePublicOffer`'s
   * exact precedent. Returns only the subset of `restaurantIds` that
   * currently have at least one active, non-deleted, `isDefault` Menu.
   */
  findRestaurantIdsWithActiveDefaultMenu(restaurantIds: RestaurantId[]): Promise<Set<string>>;
}

export const MENU_REPOSITORY = Symbol('MENU_REPOSITORY');
