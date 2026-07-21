import { OccasionCategory } from '../entities/occasion-category.entity';

/**
 * Read-only: `OccasionCategory` rows are platform-managed reference data
 * seeded via `prisma/seed.ts` (ADR-018) - no use case in this module creates,
 * updates, or deletes one.
 */
export interface OccasionCategoryRepository {
  findAllActive(): Promise<OccasionCategory[]>;
  findByIds(ids: string[]): Promise<OccasionCategory[]>;
}

export const OCCASION_CATEGORY_REPOSITORY = Symbol('OCCASION_CATEGORY_REPOSITORY');
