import {
  assertActorCanManageMenu,
  resolveMenuManagementActorId,
  MENU_MANAGE_PERMISSION,
} from './assert-actor-can-manage-menu';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  RESTAURANT_ID,
  ownerActor,
  memberActor,
  employeeActor,
  customerActor,
} from '../../../../../test/menus/support/menu-test-fixtures';

describe('assertActorCanManageMenu', () => {
  it('allows an Owner OrganizationMember', () => {
    expect(() => assertActorCanManageMenu(ownerActor(), RESTAURANT_ID)).not.toThrow();
  });

  it('allows an Admin OrganizationMember', () => {
    const admin = { ...ownerActor(), orgRole: 'Admin' };
    expect(() => assertActorCanManageMenu(admin, RESTAURANT_ID)).not.toThrow();
  });

  it('denies an OrganizationMember with a non-Owner/Admin role', () => {
    expect(() => assertActorCanManageMenu(memberActor(), RESTAURANT_ID)).toThrow(
      PermissionDeniedException,
    );
  });

  it('allows an Employee holding menu:manage for their own Restaurant', () => {
    const employee = employeeActor({ permissions: [MENU_MANAGE_PERMISSION] });
    expect(() => assertActorCanManageMenu(employee, RESTAURANT_ID)).not.toThrow();
  });

  it('denies an Employee missing menu:manage', () => {
    const employee = employeeActor({ permissions: ['reservations:create'] });
    expect(() => assertActorCanManageMenu(employee, RESTAURANT_ID)).toThrow(
      PermissionDeniedException,
    );
  });

  it('collapses an Employee of a different Restaurant to RestaurantNotFoundException (IDOR-safe)', () => {
    const employee = employeeActor({ restaurantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });
    expect(() => assertActorCanManageMenu(employee, RESTAURANT_ID)).toThrow(
      RestaurantNotFoundException,
    );
  });

  it('denies a Customer (User) actor outright', () => {
    expect(() => assertActorCanManageMenu(customerActor(), RESTAURANT_ID)).toThrow(
      PermissionDeniedException,
    );
  });

  describe('resolveMenuManagementActorId', () => {
    it("returns the Employee's own id for an Employee actor", () => {
      const employee = employeeActor({ employeeId: '22222222-2222-4222-8222-222222222222' });
      expect(resolveMenuManagementActorId(employee)).toBe('22222222-2222-4222-8222-222222222222');
    });

    it("returns the OrganizationMember's userId otherwise", () => {
      const owner = ownerActor({ userId: '11111111-1111-4111-8111-111111111111' });
      expect(resolveMenuManagementActorId(owner)).toBe('11111111-1111-4111-8111-111111111111');
    });
  });
});
