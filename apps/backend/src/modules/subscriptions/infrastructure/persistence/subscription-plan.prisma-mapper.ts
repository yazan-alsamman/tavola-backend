import { SubscriptionPlan as PrismaSubscriptionPlan } from '@prisma/client';
import { SubscriptionPlan as SubscriptionPlanEntity } from '../../domain/entities/subscription-plan.entity';

export class SubscriptionPlanPrismaMapper {
  static toDomain(row: PrismaSubscriptionPlan): SubscriptionPlanEntity {
    return SubscriptionPlanEntity.reconstitute({
      id: row.id,
      name: row.name,
      slug: row.slug,
      maxRestaurants: row.maxRestaurants,
      maxBranchesPerRestaurant: row.maxBranchesPerRestaurant,
      maxEmployeesPerRestaurant: row.maxEmployeesPerRestaurant,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toPersistence(plan: SubscriptionPlanEntity): {
    id: string;
    name: string;
    slug: string;
    maxRestaurants: number;
    maxBranchesPerRestaurant: number;
    maxEmployeesPerRestaurant: number;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } {
    const props = plan.toProps();
    return { ...props };
  }
}
