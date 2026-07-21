import { CuisineCategory } from '../entities/cuisine-category.entity';

/**
 * Read-only: `CuisineCategory` rows are platform-managed reference data
 * seeded via `prisma/seed.ts` (ADR-018) - no use case in this module creates,
 * updates, or deletes one.
 */
export interface CuisineCategoryRepository {
  findAllActive(): Promise<CuisineCategory[]>;
  findByIds(ids: string[]): Promise<CuisineCategory[]>;
}

export const CUISINE_CATEGORY_REPOSITORY = Symbol('CUISINE_CATEGORY_REPOSITORY');
