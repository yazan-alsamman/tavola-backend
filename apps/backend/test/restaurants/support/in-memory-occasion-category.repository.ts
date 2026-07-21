import { OccasionCategory } from '@modules/restaurants/domain/entities/occasion-category.entity';
import { OccasionCategoryRepository } from '@modules/restaurants/domain/repositories/occasion-category.repository';

export class InMemoryOccasionCategoryRepository implements OccasionCategoryRepository {
  private readonly rows = new Map<string, OccasionCategory>();

  seed(category: OccasionCategory): void {
    this.rows.set(category.occasionCategoryId, category);
  }

  async findAllActive(): Promise<OccasionCategory[]> {
    return [...this.rows.values()].filter((row) => row.isActive);
  }

  async findByIds(ids: string[]): Promise<OccasionCategory[]> {
    return ids.map((id) => this.rows.get(id)).filter((row): row is OccasionCategory => !!row);
  }
}
