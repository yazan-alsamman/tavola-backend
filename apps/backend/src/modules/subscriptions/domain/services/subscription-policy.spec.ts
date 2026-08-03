import { SubscriptionPolicy } from './subscription-policy';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { SubscriptionUsage } from '../entities/subscription-usage.entity';
import { Subscription } from '../entities/subscription.entity';
import { RestaurantUsage } from '@modules/restaurants/domain/entities/restaurant-usage.entity';
import { SubscriptionInactiveException } from '../exceptions/subscription-inactive.exception';
import { OrganizationLimitExceededException } from '../exceptions/organization-limit-exceeded.exception';
import { PlanDowngradeRejectedException } from '../exceptions/plan-downgrade-rejected.exception';

describe('SubscriptionPolicy', () => {
  const now = new Date('2026-07-28T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const restaurantIdA = '22222222-2222-4222-8222-222222222222';
  const restaurantIdB = '33333333-3333-4333-8333-333333333333';

  function plan(
    overrides: Partial<{
      maxRestaurants: number;
      maxBranchesPerRestaurant: number;
      maxEmployeesPerRestaurant: number;
    }> = {},
  ): SubscriptionPlan {
    return SubscriptionPlan.create({
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Plan',
      slug: 'plan',
      maxRestaurants: 10,
      maxBranchesPerRestaurant: 5,
      maxEmployeesPerRestaurant: 20,
      ...overrides,
      now,
    });
  }

  describe('assertPermitsResourceCreation', () => {
    it('does not throw for an Active subscription', () => {
      const subscription = Subscription.create({
        id: '55555555-5555-4555-8555-555555555555',
        organizationId,
        subscriptionPlanId: plan().planId.value,
        startsAt: now,
        now,
      });
      expect(() => SubscriptionPolicy.assertPermitsResourceCreation(subscription)).not.toThrow();
    });

    it('throws SubscriptionInactiveException for a Suspended subscription', () => {
      const subscription = Subscription.create({
        id: '55555555-5555-4555-8555-555555555555',
        organizationId,
        subscriptionPlanId: plan().planId.value,
        startsAt: now,
        now,
      }).suspend(now);
      expect(() => SubscriptionPolicy.assertPermitsResourceCreation(subscription)).toThrow(
        SubscriptionInactiveException,
      );
    });
  });

  describe('per-limit assertions', () => {
    it('assertUnderRestaurantLimit: throws OrganizationLimitExceededException("maxRestaurants") at the limit', () => {
      const usage = reconstituteOrgUsage(9);
      expect(() =>
        SubscriptionPolicy.assertUnderRestaurantLimit(usage, plan({ maxRestaurants: 9 })),
      ).toThrow(OrganizationLimitExceededException);
    });

    it('assertUnderBranchLimit: throws for the specific Restaurant at its own limit', () => {
      const usage = reconstituteRestaurantUsage(restaurantIdA, 5, 0);
      expect(() =>
        SubscriptionPolicy.assertUnderBranchLimit(usage, plan({ maxBranchesPerRestaurant: 5 })),
      ).toThrow(OrganizationLimitExceededException);
    });

    it('assertUnderEmployeeLimit: throws for the specific Restaurant at its own limit', () => {
      const usage = reconstituteRestaurantUsage(restaurantIdA, 0, 20);
      expect(() =>
        SubscriptionPolicy.assertUnderEmployeeLimit(usage, plan({ maxEmployeesPerRestaurant: 20 })),
      ).toThrow(OrganizationLimitExceededException);
    });

    it('does not throw when under every limit', () => {
      const orgUsage = reconstituteOrgUsage(3);
      const restaurantUsage = reconstituteRestaurantUsage(restaurantIdA, 2, 10);
      const p = plan();
      expect(() => SubscriptionPolicy.assertUnderRestaurantLimit(orgUsage, p)).not.toThrow();
      expect(() => SubscriptionPolicy.assertUnderBranchLimit(restaurantUsage, p)).not.toThrow();
      expect(() => SubscriptionPolicy.assertUnderEmployeeLimit(restaurantUsage, p)).not.toThrow();
    });
  });

  describe('validatePlanChange (downgrade safety, D13)', () => {
    it('allows a downgrade when current usage fits within the new limits', () => {
      const target = plan({
        maxRestaurants: 5,
        maxBranchesPerRestaurant: 5,
        maxEmployeesPerRestaurant: 20,
      });
      const orgUsage = reconstituteOrgUsage(3);
      const restaurantUsages = [reconstituteRestaurantUsage(restaurantIdA, 2, 10)];
      expect(() =>
        SubscriptionPolicy.validatePlanChange(target, orgUsage, restaurantUsages),
      ).not.toThrow();
    });

    it('rejects a downgrade when maxRestaurants would be violated (Organization-wide)', () => {
      const target = plan({ maxRestaurants: 2 });
      const orgUsage = reconstituteOrgUsage(3);
      expect(() => SubscriptionPolicy.validatePlanChange(target, orgUsage, [])).toThrow(
        PlanDowngradeRejectedException,
      );
    });

    it('rejects a downgrade when ANY single Restaurant exceeds the new per-Restaurant branch limit - never averaged or summed across restaurants', () => {
      const target = plan({ maxBranchesPerRestaurant: 3 });
      const orgUsage = reconstituteOrgUsage(2);
      // Restaurant A has 1 branch (fine), Restaurant B has 5 (violates) - a
      // naive "org-wide average/sum" check would incorrectly pass this.
      const restaurantUsages = [
        reconstituteRestaurantUsage(restaurantIdA, 1, 0),
        reconstituteRestaurantUsage(restaurantIdB, 5, 0),
      ];
      expect(() =>
        SubscriptionPolicy.validatePlanChange(target, orgUsage, restaurantUsages),
      ).toThrow(PlanDowngradeRejectedException);
    });

    it('rejects a downgrade when ANY single Restaurant exceeds the new per-Restaurant employee limit', () => {
      const target = plan({ maxEmployeesPerRestaurant: 3 });
      const orgUsage = reconstituteOrgUsage(2);
      const restaurantUsages = [
        reconstituteRestaurantUsage(restaurantIdA, 0, 1),
        reconstituteRestaurantUsage(restaurantIdB, 0, 10),
      ];
      expect(() =>
        SubscriptionPolicy.validatePlanChange(target, orgUsage, restaurantUsages),
      ).toThrow(PlanDowngradeRejectedException);
    });

    it('names every violated limit in one rejection, not just the first', () => {
      const target = plan({
        maxRestaurants: 1,
        maxBranchesPerRestaurant: 1,
        maxEmployeesPerRestaurant: 1,
      });
      const orgUsage = reconstituteOrgUsage(5);
      const restaurantUsages = [reconstituteRestaurantUsage(restaurantIdA, 5, 5)];
      try {
        SubscriptionPolicy.validatePlanChange(target, orgUsage, restaurantUsages);
        fail('expected PlanDowngradeRejectedException');
      } catch (error) {
        expect(error).toBeInstanceOf(PlanDowngradeRejectedException);
        expect((error as Error).message).toContain('maxRestaurants');
        expect((error as Error).message).toContain('maxBranchesPerRestaurant');
        expect((error as Error).message).toContain('maxEmployeesPerRestaurant');
      }
    });
  });

  function reconstituteOrgUsage(restaurantCount: number): SubscriptionUsage {
    return SubscriptionUsage.reconstitute({
      id: '66666666-6666-4666-8666-666666666666',
      organizationId,
      restaurantCount,
      updatedAt: now,
    });
  }

  function reconstituteRestaurantUsage(
    restaurantId: string,
    branchCount: number,
    employeeCount: number,
  ): RestaurantUsage {
    return RestaurantUsage.reconstitute({
      id: '77777777-7777-4777-8777-777777777777',
      restaurantId,
      branchCount,
      employeeCount,
      updatedAt: now,
    });
  }
});
