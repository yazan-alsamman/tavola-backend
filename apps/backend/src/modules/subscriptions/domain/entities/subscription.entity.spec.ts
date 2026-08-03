import { Subscription } from './subscription.entity';
import { SubscriptionStatus } from '../enums/subscription.enums';
import { InvalidSubscriptionStatusTransitionException } from '../exceptions/invalid-subscription-status-transition.exception';

describe('Subscription entity', () => {
  const now = new Date('2026-07-28T12:00:00.000Z');
  const later = new Date('2026-07-28T13:00:00.000Z');
  const id = '11111111-1111-4111-8111-111111111111';
  const organizationId = '22222222-2222-4222-8222-222222222222';
  const planId = '33333333-3333-4333-8333-333333333333';
  const otherPlanId = '44444444-4444-4444-8444-444444444444';

  function createActive(): Subscription {
    return Subscription.create({
      id,
      organizationId,
      subscriptionPlanId: planId,
      startsAt: now,
      now,
    });
  }

  it('creates an Active subscription with no billing-derived state, indefinite by default', () => {
    const subscription = createActive();
    expect(subscription.status).toBe(SubscriptionStatus.Active);
    expect(subscription.endsAt).toBeNull();
    expect(subscription.permitsResourceCreation()).toBe(true);
  });

  it('changePlan: Active -> Active with new plan id', () => {
    const changed = createActive().changePlan(otherPlanId, later);
    expect(changed.subscriptionPlanId.value).toBe(otherPlanId);
    expect(changed.status).toBe(SubscriptionStatus.Active);
  });

  it('changePlan: rejected when not Active', () => {
    const suspended = createActive().suspend(later);
    expect(() => suspended.changePlan(otherPlanId, later)).toThrow(
      InvalidSubscriptionStatusTransitionException,
    );
  });

  it('suspend: Active -> Suspended, blocks new resource creation', () => {
    const suspended = createActive().suspend(later);
    expect(suspended.status).toBe(SubscriptionStatus.Suspended);
    expect(suspended.permitsResourceCreation()).toBe(false);
  });

  it('suspend: rejected when not Active', () => {
    const suspended = createActive().suspend(later);
    expect(() => suspended.suspend(later)).toThrow(InvalidSubscriptionStatusTransitionException);
  });

  it('reactivate: Suspended -> Active', () => {
    const reactivated = createActive().suspend(later).reactivate(later);
    expect(reactivated.status).toBe(SubscriptionStatus.Active);
    expect(reactivated.permitsResourceCreation()).toBe(true);
  });

  it('reactivate: rejected when not Suspended (e.g. Active)', () => {
    expect(() => createActive().reactivate(later)).toThrow(
      InvalidSubscriptionStatusTransitionException,
    );
  });

  it('reactivate: rejected when Cancelled (only Assign/reassign resumes Cancelled, not Reactivate)', () => {
    const cancelled = createActive().cancel(later);
    expect(() => cancelled.reactivate(later)).toThrow(InvalidSubscriptionStatusTransitionException);
  });

  it('cancel: Active -> Cancelled, terminal, blocks new resource creation', () => {
    const cancelled = createActive().cancel(later);
    expect(cancelled.status).toBe(SubscriptionStatus.Cancelled);
    expect(cancelled.permitsResourceCreation()).toBe(false);
  });

  it('cancel: rejected when not Active', () => {
    const suspended = createActive().suspend(later);
    expect(() => suspended.cancel(later)).toThrow(InvalidSubscriptionStatusTransitionException);
  });

  it('reassign: Cancelled -> Active with a fresh plan and startsAt, endsAt reset to null by default', () => {
    const cancelled = createActive().cancel(later);
    const reassigned = cancelled.reassign(otherPlanId, later, later);
    expect(reassigned.status).toBe(SubscriptionStatus.Active);
    expect(reassigned.subscriptionPlanId.value).toBe(otherPlanId);
    expect(reassigned.startsAt).toEqual(later);
    expect(reassigned.endsAt).toBeNull();
  });

  it('reassign: also valid from Expired (implementation-time reconciliation, ADR-027)', () => {
    const withEndsAt = Subscription.create({
      id,
      organizationId,
      subscriptionPlanId: planId,
      startsAt: now,
      endsAt: now,
      now,
    });
    const expired = withEndsAt.expire(now);
    expect(expired.status).toBe(SubscriptionStatus.Expired);
    const reassigned = expired.reassign(otherPlanId, later, later);
    expect(reassigned.status).toBe(SubscriptionStatus.Active);
  });

  it('reassign: rejected when Active (must use changePlan instead)', () => {
    expect(() => createActive().reassign(otherPlanId, later, later)).toThrow(
      InvalidSubscriptionStatusTransitionException,
    );
  });

  it('reassign: rejected when Suspended (must Reactivate instead)', () => {
    const suspended = createActive().suspend(later);
    expect(() => suspended.reassign(otherPlanId, later, later)).toThrow(
      InvalidSubscriptionStatusTransitionException,
    );
  });

  it('expire: Active -> Expired only when endsAt has elapsed', () => {
    const withEndsAt = Subscription.create({
      id,
      organizationId,
      subscriptionPlanId: planId,
      startsAt: now,
      endsAt: later,
      now,
    });
    const expired = withEndsAt.expire(later);
    expect(expired.status).toBe(SubscriptionStatus.Expired);
    expect(expired.permitsResourceCreation()).toBe(false);
  });

  it('expire: rejected when endsAt is null (indefinite)', () => {
    expect(() => createActive().expire(later)).toThrow(
      InvalidSubscriptionStatusTransitionException,
    );
  });

  it('expire: rejected when endsAt has not yet elapsed', () => {
    const withFutureEndsAt = Subscription.create({
      id,
      organizationId,
      subscriptionPlanId: planId,
      startsAt: now,
      endsAt: new Date('2026-08-01T00:00:00.000Z'),
      now,
    });
    expect(() => withFutureEndsAt.expire(later)).toThrow(
      InvalidSubscriptionStatusTransitionException,
    );
  });

  it('expire: rejected when not Active', () => {
    const suspended = createActive().suspend(later);
    expect(() => suspended.expire(later)).toThrow(InvalidSubscriptionStatusTransitionException);
  });
});
