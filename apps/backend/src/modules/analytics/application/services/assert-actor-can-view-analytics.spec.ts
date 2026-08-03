import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import {
  assertActorCanViewAnalytics,
  assertActorCanViewOrganizationAnalytics,
  resolveEffectiveBranchIdFilter,
  REPORTS_VIEW_PERMISSION,
} from './assert-actor-can-view-analytics';

const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RESTAURANT_ID = '22222222-2222-4222-8222-222222222222';
const BRANCH_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_BRANCH_ID = '44444444-4444-4444-8444-444444444444';

function ownerActor(role: OrganizationMemberRole = OrganizationMemberRole.Owner) {
  return {
    actorType: AccessTokenActorType.OrganizationMember as const,
    userId: 'user-1',
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
    organizationId: 'org-1',
    orgRole: role,
    permissionsVersion: 1,
  };
}

function employeeActor(
  overrides: Partial<{ branchIds: string[]; permissions: string[]; restaurantId: string }> = {},
) {
  return {
    actorType: AccessTokenActorType.Employee as const,
    userId: 'user-2',
    sessionId: 'session-2',
    sessionVersion: 1,
    tokenFamilyId: 'family-2',
    employeeId: 'employee-1',
    organizationId: 'org-1',
    restaurantId: overrides.restaurantId ?? RESTAURANT_ID,
    branchIds: overrides.branchIds ?? [],
    permissions: overrides.permissions ?? [REPORTS_VIEW_PERMISSION],
    permissionsVersion: 1,
  };
}

function customerActor() {
  return {
    actorType: AccessTokenActorType.User as const,
    userId: 'user-3',
    sessionId: 'session-3',
    sessionVersion: 1,
    tokenFamilyId: 'family-3',
  };
}

describe('assertActorCanViewAnalytics', () => {
  it('allows an OrganizationMember Owner', () => {
    expect(() =>
      assertActorCanViewAnalytics(ownerActor(OrganizationMemberRole.Owner), RESTAURANT_ID, null),
    ).not.toThrow();
  });

  it('allows an OrganizationMember Admin', () => {
    expect(() =>
      assertActorCanViewAnalytics(ownerActor(OrganizationMemberRole.Admin), RESTAURANT_ID, null),
    ).not.toThrow();
  });

  it('denies an OrganizationMember with a non-Owner/Admin role', () => {
    expect(() =>
      assertActorCanViewAnalytics(ownerActor(OrganizationMemberRole.Staff), RESTAURANT_ID, null),
    ).toThrow(PermissionDeniedException);
  });

  it('allows an Employee holding reports:view for their own restaurant', () => {
    expect(() => assertActorCanViewAnalytics(employeeActor(), RESTAURANT_ID, null)).not.toThrow();
  });

  it('denies an Employee missing reports:view', () => {
    expect(() =>
      assertActorCanViewAnalytics(employeeActor({ permissions: [] }), RESTAURANT_ID, null),
    ).toThrow(PermissionDeniedException);
  });

  it('collapses a different-restaurant Employee to RestaurantNotFoundException (IDOR-safe)', () => {
    expect(() =>
      assertActorCanViewAnalytics(
        employeeActor({ restaurantId: OTHER_RESTAURANT_ID }),
        RESTAURANT_ID,
        null,
      ),
    ).toThrow(RestaurantNotFoundException);
  });

  it('allows a branch-restricted Employee for their assigned branch', () => {
    expect(() =>
      assertActorCanViewAnalytics(
        employeeActor({ branchIds: [BRANCH_ID] }),
        RESTAURANT_ID,
        BranchId.create(BRANCH_ID),
      ),
    ).not.toThrow();
  });

  it('denies a branch-restricted Employee for a branch they are not assigned to', () => {
    expect(() =>
      assertActorCanViewAnalytics(
        employeeActor({ branchIds: [OTHER_BRANCH_ID] }),
        RESTAURANT_ID,
        BranchId.create(BRANCH_ID),
      ),
    ).toThrow(EmployeeBranchNotAssignedException);
  });

  it('allows an Employee with restaurant-wide scope (empty branchIds) for any branch', () => {
    expect(() =>
      assertActorCanViewAnalytics(
        employeeActor({ branchIds: [] }),
        RESTAURANT_ID,
        BranchId.create(BRANCH_ID),
      ),
    ).not.toThrow();
  });

  it('denies a Customer (User) actor outright', () => {
    expect(() => assertActorCanViewAnalytics(customerActor(), RESTAURANT_ID, null)).toThrow(
      PermissionDeniedException,
    );
  });
});

describe('assertActorCanViewOrganizationAnalytics', () => {
  it('allows Owner/Admin', () => {
    expect(() =>
      assertActorCanViewOrganizationAnalytics(ownerActor(OrganizationMemberRole.Owner)),
    ).not.toThrow();
    expect(() =>
      assertActorCanViewOrganizationAnalytics(ownerActor(OrganizationMemberRole.Admin)),
    ).not.toThrow();
  });

  it('denies a non-Owner/Admin OrganizationMember', () => {
    expect(() =>
      assertActorCanViewOrganizationAnalytics(ownerActor(OrganizationMemberRole.Staff)),
    ).toThrow(PermissionDeniedException);
  });

  it('denies an Employee (always restaurant-scoped, never organization-scoped)', () => {
    expect(() => assertActorCanViewOrganizationAnalytics(employeeActor())).toThrow(
      PermissionDeniedException,
    );
  });

  it('denies a Customer actor', () => {
    expect(() => assertActorCanViewOrganizationAnalytics(customerActor())).toThrow(
      PermissionDeniedException,
    );
  });
});

describe('resolveEffectiveBranchIdFilter', () => {
  it('returns null (unrestricted) for an OrganizationMember', () => {
    expect(resolveEffectiveBranchIdFilter(ownerActor())).toBeNull();
  });

  it('returns null for a restaurant-wide-scope Employee (empty branchIds)', () => {
    expect(resolveEffectiveBranchIdFilter(employeeActor({ branchIds: [] }))).toBeNull();
  });

  it('returns the assigned branch list for a branch-restricted Employee', () => {
    expect(resolveEffectiveBranchIdFilter(employeeActor({ branchIds: [BRANCH_ID] }))).toEqual([
      BRANCH_ID,
    ]);
  });
});
