import { SubscriptionPlan } from '@modules/subscriptions/domain/entities/subscription-plan.entity';
import { SubscriptionPlanRepository } from '@modules/subscriptions/domain/repositories/subscription-plan.repository';
import { SubscriptionPlanId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemorySubscriptionPlanRepository implements SubscriptionPlanRepository {
  private readonly rows = new Map<string, SubscriptionPlan>();

  async findById(id: SubscriptionPlanId): Promise<SubscriptionPlan | null> {
    return this.rows.get(id.value) ?? null;
  }

  async findBySlug(slug: string): Promise<SubscriptionPlan | null> {
    for (const row of this.rows.values()) {
      if (row.slug === slug) {
        return row;
      }
    }
    return null;
  }

  async findMany(): Promise<SubscriptionPlan[]> {
    return [...this.rows.values()];
  }

  async save(plan: SubscriptionPlan): Promise<void> {
    this.rows.set(plan.planId.value, plan);
  }
}
