import { SubscriptionUsage } from '@modules/subscriptions/domain/entities/subscription-usage.entity';
import { SubscriptionUsageRepository } from '@modules/subscriptions/domain/repositories/subscription-usage.repository';

/** Same "explicit current org" simplification as `InMemorySubscriptionRepository` - see its own doc comment. */
export class InMemorySubscriptionUsageRepository implements SubscriptionUsageRepository {
  private readonly rows = new Map<string, SubscriptionUsage>();

  constructor(private currentOrganizationId: string | null = null) {}

  setCurrentOrganizationId(organizationId: string | null): void {
    this.currentOrganizationId = organizationId;
  }

  async findByOrganizationId(): Promise<SubscriptionUsage | null> {
    if (this.currentOrganizationId === null) {
      return null;
    }
    return this.rows.get(this.currentOrganizationId) ?? null;
  }

  async create(usage: SubscriptionUsage): Promise<void> {
    this.rows.set(usage.organizationId, usage);
  }

  async incrementRestaurantCountIfUnderLimit(
    organizationId: string,
    limit: number,
  ): Promise<boolean> {
    const existing = this.rows.get(organizationId);
    if (!existing || existing.restaurantCount >= limit) {
      return false;
    }
    this.rows.set(
      organizationId,
      SubscriptionUsage.reconstitute({
        ...existing.toProps(),
        restaurantCount: existing.restaurantCount + 1,
        updatedAt: new Date(),
      }),
    );
    return true;
  }

  async decrementRestaurantCount(organizationId: string): Promise<void> {
    const existing = this.rows.get(organizationId);
    if (!existing || existing.restaurantCount <= 0) {
      return;
    }
    this.rows.set(
      organizationId,
      SubscriptionUsage.reconstitute({
        ...existing.toProps(),
        restaurantCount: existing.restaurantCount - 1,
        updatedAt: new Date(),
      }),
    );
  }
}
