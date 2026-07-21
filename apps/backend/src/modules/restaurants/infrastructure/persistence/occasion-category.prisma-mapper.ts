import { OccasionCategory as PrismaOccasionCategory } from '@prisma/client';
import { OccasionCategory as OccasionCategoryEntity } from '../../domain/entities/occasion-category.entity';

export class OccasionCategoryPrismaMapper {
  static toDomain(row: PrismaOccasionCategory): OccasionCategoryEntity {
    return OccasionCategoryEntity.reconstitute({
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
