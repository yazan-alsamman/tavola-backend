import { Subscription } from '@modules/subscriptions/domain/entities/subscription.entity';
import { SubscriptionStatus } from '@modules/subscriptions/domain/enums/subscription.enums';
import { SubscriptionRepository } from '@modules/subscriptions/domain/repositories/subscription.repository';
import { SubscriptionId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * Test double for `SubscriptionRepository`. Real `Subscription` is a
 * `DIRECT_TENANT_OWNED_MODEL`, so the production repository's
 * `findByOrganizationId()` implicitly reads the bound TenantContext - this
 * fake instead takes an explicit `currentOrganizationId` accessor so unit
 * tests remain simple (no AsyncLocalStorage machinery needed), mirroring
 * `InMemoryRestaurantRepository`'s "no tenant scoping enforced" simplification.
 */
export class InMemorySubscriptionRepository implements SubscriptionRepository {
  private readonly rows = new Map<string, Subscription>();

  constructor(private currentOrganizationId: string | null = null) {}

  setCurrentOrganizationId(organizationId: string | null): void {
    this.currentOrganizationId = organizationId;
  }

  async findByOrganizationId(): Promise<Subscription | null> {
    if (this.currentOrganizationId === null) {
      return null;
    }
    for (const row of this.rows.values()) {
      if (row.organizationId === this.currentOrganizationId) {
        return row;
      }
    }
    return null;
  }

  async findById(id: SubscriptionId): Promise<Subscription | null> {
    return this.rows.get(id.value) ?? null;
  }

  async create(subscription: Subscription): Promise<void> {
    this.rows.set(subscription.subscriptionId.value, subscription);
  }

  async updateIfStatus(
    subscription: Subscription,
    expectedStatus: SubscriptionStatus,
  ): Promise<boolean> {
    const existing = this.rows.get(subscription.subscriptionId.value);
    if (!existing || existing.status !== expectedStatus) {
      return false;
    }
    this.rows.set(subscription.subscriptionId.value, subscription);
    return true;
  }

  async expireIfActiveAndDue(id: SubscriptionId, at: Date): Promise<boolean> {
    const existing = this.rows.get(id.value);
    if (
      !existing ||
      existing.status !== SubscriptionStatus.Active ||
      existing.endsAt === null ||
      existing.endsAt.getTime() > at.getTime()
    ) {
      return false;
    }
    this.rows.set(id.value, existing.expire(at));
    return true;
  }
}
