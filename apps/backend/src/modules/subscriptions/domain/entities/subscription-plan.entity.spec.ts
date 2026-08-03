import { SubscriptionPlan } from './subscription-plan.entity';
import { InvalidSubscriptionStatusTransitionException } from '../exceptions/invalid-subscription-status-transition.exception';

describe('SubscriptionPlan entity', () => {
  const now = new Date('2026-07-28T12:00:00.000Z');

  function createPlan(): SubscriptionPlan {
    return SubscriptionPlan.create({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Default Plan',
      slug: 'default',
      maxRestaurants: 10,
      maxBranchesPerRestaurant: 5,
      maxEmployeesPerRestaurant: 20,
      now,
    });
  }

  it('creates a plan with the given limits, not archived', () => {
    const plan = createPlan();
    expect(plan.maxRestaurants).toBe(10);
    expect(plan.maxBranchesPerRestaurant).toBe(5);
    expect(plan.maxEmployeesPerRestaurant).toBe(20);
    expect(plan.isArchived()).toBe(false);
    expect(plan.archivedAt).toBeNull();
  });

  it('regression: create() validates only the three numeric limit fields, not id/name/slug/now (the string id must never be treated as a limit)', () => {
    // Guards against the exact bug found during Phase 12 test runs: an
    // earlier implementation passed the *entire* props object (including
    // the UUID `id` string) into the nonnegative-integer validator.
    expect(() => createPlan()).not.toThrow();
  });

  it('rejects a negative limit', () => {
    expect(() =>
      SubscriptionPlan.create({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Bad Plan',
        slug: 'bad-plan',
        maxRestaurants: -1,
        maxBranchesPerRestaurant: 5,
        maxEmployeesPerRestaurant: 20,
        now,
      }),
    ).toThrow('maxRestaurants must be a nonnegative integer.');
  });

  it('rejects a non-integer limit', () => {
    expect(() =>
      SubscriptionPlan.create({
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Bad Plan',
        slug: 'bad-plan',
        maxRestaurants: 10,
        maxBranchesPerRestaurant: 5.5,
        maxEmployeesPerRestaurant: 20,
        now,
      }),
    ).toThrow('maxBranchesPerRestaurant must be a nonnegative integer.');
  });

  it('archive: excludes the plan from new assignment without touching its limits', () => {
    const archived = createPlan().archive(now);
    expect(archived.isArchived()).toBe(true);
    expect(archived.archivedAt).toEqual(now);
    expect(archived.maxRestaurants).toBe(10);
  });

  it('archive: rejected when already archived', () => {
    const archived = createPlan().archive(now);
    expect(() => archived.archive(now)).toThrow(InvalidSubscriptionStatusTransitionException);
  });

  it('exposes no limit-mutating method - Plan Immutability (ADR-027 Section 10) by construction', () => {
    const plan = createPlan();
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(plan));
    expect(methodNames).not.toContain('changeLimits');
    expect(methodNames).not.toContain('updateLimits');
    expect(methodNames).not.toContain('setMaxRestaurants');
  });
});
