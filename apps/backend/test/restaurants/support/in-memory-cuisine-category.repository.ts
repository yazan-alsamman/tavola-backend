import { CuisineCategory } from '@modules/restaurants/domain/entities/cuisine-category.entity';
import { CuisineCategoryRepository } from '@modules/restaurants/domain/repositories/cuisine-category.repository';

export class InMemoryCuisineCategoryRepository implements CuisineCategoryRepository {
  private readonly rows = new Map<string, CuisineCategory>();

  seed(category: CuisineCategory): void {
    this.rows.set(category.cuisineCategoryId, category);
  }

  async findAllActive(): Promise<CuisineCategory[]> {
    return [...this.rows.values()].filter((row) => row.isActive);
  }

  async findByIds(ids: string[]): Promise<CuisineCategory[]> {
    return ids.map((id) => this.rows.get(id)).filter((row): row is CuisineCategory => !!row);
  }
}
