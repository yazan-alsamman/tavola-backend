import { CuisineCategory as PrismaCuisineCategory } from '@prisma/client';
import { CuisineCategory as CuisineCategoryEntity } from '../../domain/entities/cuisine-category.entity';

export class CuisineCategoryPrismaMapper {
  static toDomain(row: PrismaCuisineCategory): CuisineCategoryEntity {
    return CuisineCategoryEntity.reconstitute({
      id: row.id,
      slug: row.slug,
      name: row.name,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
