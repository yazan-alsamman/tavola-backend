import { PermissionResolver } from './services/permission-resolver';
import { PermissionSlug } from '@shared/domain/value-objects/permission-slug.vo';
import { RolePermissionType } from './enums/authorization.enums';
import { PermissionDeniedException } from './exceptions/permission-denied.exception';
import { Employee, EmployeeProps } from './entities/employee.entity';
import { EmployeeStatus } from './enums/authorization.enums';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import { EmployeeBranchNotAssignedException } from './exceptions/employee-branch-not-assigned.exception';

describe('PermissionResolver', () => {
  it('applies revocations over grants', () => {
    const effective = PermissionResolver.resolveEffectivePermissions({
      rolePermissionSlugs: ['reservations:create', 'reservations:approve'],
      individualGrants: ['tables:manage'],
      individualRevocations: ['reservations:approve'],
    });

    expect(effective.has('reservations:create')).toBe(true);
    expect(effective.has('reservations:approve')).toBe(false);
    expect(effective.has('tables:manage')).toBe(true);
  });

  it('asserts required permission', () => {
    const effective = new Set(['reservations:create']);
    expect(() =>
      PermissionResolver.assertPermission(effective, PermissionSlug.create('reservations:approve')),
    ).toThrow(PermissionDeniedException);
  });

  it('resolves from typed grant records', () => {
    const effective = PermissionResolver.resolveFromRecords([
      { slug: 'reservations:create', type: RolePermissionType.RoleGrant },
      { slug: 'reservations:approve', type: RolePermissionType.IndividualRevocation },
    ]);
    expect(effective.has('reservations:create')).toBe(true);
    expect(effective.has('reservations:approve')).toBe(false);
  });
});

describe('Employee entity', () => {
  const base: EmployeeProps = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    restaurantId: '550e8400-e29b-41d4-a716-446655440002',
    roleId: '550e8400-e29b-41d4-a716-446655440003',
    userId: '550e8400-e29b-41d4-a716-446655440000',
    permissionsVersion: 1,
    firstName: 'Staff',
    lastName: 'Member',
    email: 'staff@example.com',
    phone: null,
    status: EmployeeStatus.Active,
    assignedBranchIds: ['550e8400-e29b-41d4-a716-446655440004'],
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  it('enforces branch scope when assignments exist', () => {
    const employee = Employee.create(base);
    expect(() =>
      employee.assertBranchScope(BranchId.create('550e8400-e29b-41d4-a716-446655440099')),
    ).toThrow(EmployeeBranchNotAssignedException);
  });

  it('allows restaurant-wide scope with no assignments', () => {
    const employee = Employee.create({ ...base, assignedBranchIds: [] });
    expect(() =>
      employee.assertBranchScope(BranchId.create('550e8400-e29b-41d4-a716-446655440099')),
    ).not.toThrow();
  });
});
