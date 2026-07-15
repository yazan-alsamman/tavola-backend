import { RestaurantSlug } from '@shared/domain/value-objects/restaurant-slug.vo';

export function deriveRestaurantSlugFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

export function resolveRestaurantSlug(restaurantName: string, restaurantSlug?: string): string {
  const candidate =
    restaurantSlug !== undefined && restaurantSlug.trim().length > 0
      ? restaurantSlug.trim().toLowerCase()
      : deriveRestaurantSlugFromName(restaurantName);

  return RestaurantSlug.create(candidate).value;
}
