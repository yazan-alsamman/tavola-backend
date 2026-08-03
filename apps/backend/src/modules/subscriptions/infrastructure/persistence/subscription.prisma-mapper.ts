import { Subscription as PrismaSubscription } from '@prisma/client';
import { Subscription as SubscriptionEntity } from '../../domain/entities/subscription.entity';
import { SubscriptionStatus } from '../../domain/enums/subscription.enums';

export class SubscriptionPrismaMapper {
  static toDomain(row: PrismaSubscription): SubscriptionEntity {
    return SubscriptionEntity.reconstitute({
      id: row.id,
      organizationId: row.organizationId,
      subscriptionPlanId: row.subscriptionPlanId,
      status: row.status as SubscriptionStatus,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toPersistence(subscription: SubscriptionEntity): {
    id: string;
    organizationId: string;
    subscriptionPlanId: string;
    status: SubscriptionStatus;
    startsAt: Date;
    endsAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } {
    const props = subscription.toProps();
    return { ...props };
  }
}
