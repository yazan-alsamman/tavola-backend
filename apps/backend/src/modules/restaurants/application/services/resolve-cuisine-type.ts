import { CuisineCategoryRepository } from '../../domain/repositories/cuisine-category.repository';
import { UnknownCuisineTypeException } from '../../domain/exceptions/unknown-cuisine-type.exception';

/**
 * The single place every Restaurant write path (tenant Create/Update and the
 * Platform Owner create that delegates to Create) turns a requested
 * `cuisineType` into the value the entity stores.
 *
 * `cuisineType` is a closed list: it must name an active `CuisineCategory`
 * (platform-managed reference data, ADR-018). The match is case-insensitive
 * against the category's `name` or `slug`, and the stored value is always the
 * category's canonical `name`, so the display string clients already render
 * stays consistent across restaurants.
 *
 * Restaurants saved before the list was enforced may hold a free-text value.
 * Update is full-replace, so re-sending that unchanged value (`currentValue`)
 * is accepted as-is: editing a restaurant's name must not fail because of a
 * historical cuisine string. Any *new* value must come from the list.
 *
 * `null`, `undefined` and a blank string all mean "no cuisine type".
 */
export async function resolveCuisineType(
  cuisineCategoryRepository: CuisineCategoryRepository,
  requested: string | null | undefined,
  currentValue: string | null = null,
): Promise<string | null> {
  const trimmed = requested?.trim() ?? '';
  if (trimmed === '') {
    return null;
  }
  if (currentValue !== null && trimmed === currentValue.trim()) {
    return currentValue;
  }

  const needle = trimmed.toLowerCase();
  const categories = await cuisineCategoryRepository.findAllActive();
  const match = categories.find(
    (category) =>
      category.name.trim().toLowerCase() === needle || category.slug.toLowerCase() === needle,
  );
  if (match === undefined) {
    throw new UnknownCuisineTypeException();
  }
  return match.name;
}
