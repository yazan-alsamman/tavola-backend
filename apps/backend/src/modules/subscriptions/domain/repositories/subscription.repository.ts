import { Subscription } from '../entities/subscription.entity';
import { SubscriptionId } from '@shared/domain/value-objects/identifiers.vo';
import { SubscriptionStatus } from '../enums/subscription.enums';

/**
 * `Subscription` is a direct tenant-owned model (`organizationId`, unique -
 * TENANCY.md, ADR-027 §12) - registered in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS`. PlatformAdmin use cases bind
 * `TenantContext` to the *target* Organization's id first (mirroring
 * `ProvisionRestaurantOwnerUseCase`'s bootstrap pattern, since
 * `PlatformAdminGuard` never runs `TenantContextInterceptor`), so every
 * method here is implicitly scoped to that bound organization - no
 * `organizationId` parameter needed on the tenant-scoped lookups.
 */
export interface SubscriptionRepository {
  /** Tenant-scoped - resolves to the Subscription of whichever Organization the caller's bound TenantContext names. */
  findByOrganizationId(): Promise<Subscription | null>;

  /** Used only by the BullMQ expiration job (System actor, cross-tenant) - no tenant scope. */
  findById(id: SubscriptionId): Promise<Subscription | null>;

  create(subscription: Subscription): Promise<void>;

  /**
   * Conditional `UPDATE ... WHERE id = ? AND status = expectedStatus` -
   * persists every mutable field (status, subscriptionPlanId, startsAt,
   * endsAt). Returns `false` if a concurrent transition already moved the
   * Subscription away from `expectedStatus` between the caller's read and
   * this write - mirrors `OfferRepository.updateIfDraft`/`publishIfDraft`.
   */
  updateIfStatus(subscription: Subscription, expectedStatus: SubscriptionStatus): Promise<boolean>;

  /**
   * The BullMQ expiration job's sole write -
   * `UPDATE subscriptions SET status = 'Expired', updated_at = ? WHERE id = ?
   * AND status = 'Active' AND ends_at <= ?`. Returns `false` if no longer
   * Active or not yet due (already expired by a previous, retried execution
   * of this same job) - the processor treats `false` as a safe no-op, never
   * an error, exactly like `ExpireOfferUseCase`.
   */
  expireIfActiveAndDue(id: SubscriptionId, at: Date): Promise<boolean>;
}

export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY');
