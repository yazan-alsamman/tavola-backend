import { Entity } from '@shared/domain/base/entity.base';
import { SubscriptionId, SubscriptionPlanId } from '@shared/domain/value-objects/identifiers.vo';
import { SubscriptionStatus } from '../enums/subscription.enums';
import { InvalidSubscriptionStatusTransitionException } from '../exceptions/invalid-subscription-status-transition.exception';

export interface SubscriptionProps {
  id: string;
  organizationId: string;
  subscriptionPlanId: string;
  status: SubscriptionStatus;
  startsAt: Date;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Aggregate root (Phase 12, architecture frozen 2026-07-28, ADR-027).
 * Entitlement/access contract only - never a billing subscription. Exactly
 * one Subscription per Organization (ADR-011, reaffirmed by ADR-027 §1).
 *
 * State machine (ADR-027 §6, frozen, no billing-derived states):
 *
 *   (create/assign) -> Active
 *   Active -> Suspended        (administrative pause, reactivatable)
 *   Suspended -> Active        (reactivate)
 *   Active -> Cancelled        (terminal - resumed only via a fresh
 *                               plan assignment, not Reactivate)
 *   Cancelled -> Active        (resume, via reassign - a fresh Assign)
 *   Active -> Expired          (automatic, endsAt elapsed)
 *
 * No `PastDue`/`Trialing`. No transition this class does not explicitly
 * expose is valid - every method defensively re-asserts its own precondition
 * (the domain layer never trusts the application layer alone, matching
 * `Offer.publish`'s own precedent).
 */
export class Subscription extends Entity<SubscriptionProps> {
  private constructor(props: SubscriptionProps) {
    super(props);
  }

  /** Used both for a brand-new Organization's default plan and for a PlatformAdmin's initial assignment. */
  static create(props: {
    id: string;
    organizationId: string;
    subscriptionPlanId: string;
    startsAt: Date;
    endsAt?: Date | null;
    now: Date;
  }): Subscription {
    return new Subscription({
      id: props.id,
      organizationId: props.organizationId,
      subscriptionPlanId: props.subscriptionPlanId,
      status: SubscriptionStatus.Active,
      startsAt: props.startsAt,
      endsAt: props.endsAt ?? null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: SubscriptionProps): Subscription {
    return new Subscription({ ...props });
  }

  get subscriptionId(): SubscriptionId {
    return SubscriptionId.create(this.props.id);
  }

  get organizationId(): string {
    return this.props.organizationId;
  }

  get subscriptionPlanId(): SubscriptionPlanId {
    return SubscriptionPlanId.create(this.props.subscriptionPlanId);
  }

  get status(): SubscriptionStatus {
    return this.props.status;
  }

  get startsAt(): Date {
    return new Date(this.props.startsAt.getTime());
  }

  get endsAt(): Date | null {
    return this.props.endsAt ? new Date(this.props.endsAt.getTime()) : null;
  }

  isActive(): boolean {
    return this.props.status === SubscriptionStatus.Active;
  }

  /** ADR-027 §9 - an expired/suspended/cancelled Subscription blocks only new resource creation. */
  permitsResourceCreation(): boolean {
    return this.props.status === SubscriptionStatus.Active;
  }

  /**
   * `Active -> Cancelled` immediate plan change (ADR-027 §7/D12) - no
   * `effectiveAt` scheduling, no proration. Downgrade-safety validation
   * (D13) is a `SubscriptionPolicy` concern (checked before this is called),
   * not this entity's own responsibility - this method only performs the
   * state transition once the caller has already decided it is safe.
   */
  changePlan(newPlanId: string, at: Date): Subscription {
    if (this.props.status !== SubscriptionStatus.Active) {
      throw new InvalidSubscriptionStatusTransitionException(
        'Cannot change plan - subscription is not Active.',
      );
    }
    return Subscription.reconstitute({
      ...this.props,
      subscriptionPlanId: newPlanId,
      updatedAt: at,
    });
  }

  /** `Suspended -> Active` only. */
  suspend(at: Date): Subscription {
    if (this.props.status !== SubscriptionStatus.Active) {
      throw new InvalidSubscriptionStatusTransitionException(
        'Cannot suspend - subscription is not Active.',
      );
    }
    return Subscription.reconstitute({
      ...this.props,
      status: SubscriptionStatus.Suspended,
      updatedAt: at,
    });
  }

  /** `Suspended -> Active` only - the sole path back to Active from Suspended. */
  reactivate(at: Date): Subscription {
    if (this.props.status !== SubscriptionStatus.Suspended) {
      throw new InvalidSubscriptionStatusTransitionException(
        'Cannot reactivate - subscription is not Suspended.',
      );
    }
    return Subscription.reconstitute({
      ...this.props,
      status: SubscriptionStatus.Active,
      updatedAt: at,
    });
  }

  /** `Active -> Cancelled` only. Terminal - not automatically reactivated. */
  cancel(at: Date): Subscription {
    if (this.props.status !== SubscriptionStatus.Active) {
      throw new InvalidSubscriptionStatusTransitionException(
        'Cannot cancel - subscription is not Active.',
      );
    }
    return Subscription.reconstitute({
      ...this.props,
      status: SubscriptionStatus.Cancelled,
      updatedAt: at,
    });
  }

  /**
   * `Cancelled -> Active` or `Expired -> Active` - resuming a lapsed
   * subscription via a fresh plan assignment (ADR-027's `SubscriptionAssigned`
   * event note). Distinct from `reactivate()`, which only resumes from
   * `Suspended`. `Expired` is included alongside `Cancelled` here as an
   * implementation-time reconciliation: the frozen API surface exposes a
   * single `POST .../subscription` assignment endpoint (no separate
   * "resume expired" endpoint was frozen), and both states share the same
   * "not currently active, needs a fresh grant" shape - unlike `Suspended`,
   * which is deliberately resumed only via the symmetric `Reactivate` action.
   */
  reassign(newPlanId: string, startsAt: Date, at: Date, endsAt: Date | null = null): Subscription {
    if (
      this.props.status !== SubscriptionStatus.Cancelled &&
      this.props.status !== SubscriptionStatus.Expired
    ) {
      throw new InvalidSubscriptionStatusTransitionException(
        'Cannot reassign - subscription is not Cancelled or Expired.',
      );
    }
    return Subscription.reconstitute({
      ...this.props,
      subscriptionPlanId: newPlanId,
      status: SubscriptionStatus.Active,
      startsAt,
      endsAt,
      updatedAt: at,
    });
  }

  /**
   * `Active -> Expired` only. The actual concurrency authority is the
   * repository's CAS (`WHERE status = 'Active' AND ends_at <= now`) -
   * mirrors `Offer.expire()`'s own precedent exactly; this method builds the
   * next in-memory state, it is not itself a concurrency guarantee.
   */
  expire(at: Date): Subscription {
    if (this.props.status !== SubscriptionStatus.Active) {
      throw new InvalidSubscriptionStatusTransitionException(
        'Cannot expire - subscription is not Active.',
      );
    }
    if (this.props.endsAt === null || this.props.endsAt.getTime() > at.getTime()) {
      throw new InvalidSubscriptionStatusTransitionException(
        'Cannot expire - endsAt has not elapsed.',
      );
    }
    return Subscription.reconstitute({
      ...this.props,
      status: SubscriptionStatus.Expired,
      updatedAt: at,
    });
  }

  toProps(): Readonly<SubscriptionProps> {
    return { ...this.props };
  }
}
