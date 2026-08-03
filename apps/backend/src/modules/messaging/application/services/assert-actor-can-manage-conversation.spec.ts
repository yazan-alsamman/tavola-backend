import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  AuthenticatedEmployeeActor,
  AuthenticatedOrganizationMemberActor,
  AuthenticatedUserActor,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import { ConversationNotFoundException } from '../../domain/exceptions/conversation-not-found.exception';
import { MessageSenderType } from '../../domain/enums/messaging.enums';
import {
  assertActorCanManageConversation,
  resolveMessagingActorId,
  resolveMessageSender,
} from './assert-actor-can-manage-conversation';

const organizationId = '11111111-1111-4111-8111-111111111111';
const otherOrganizationId = '99999999-9999-4999-8999-999999999999';
const branchId = BranchId.create('22222222-2222-4222-8222-222222222222');
const otherBranchId = BranchId.create('88888888-8888-4888-8888-888888888888');

function employeeActor(
  overrides: Partial<AuthenticatedEmployeeActor> = {},
): AuthenticatedEmployeeActor {
  return {
    actorType: AccessTokenActorType.Employee,
    userId: 'employee-user-1',
    sessionId: 's1',
    sessionVersion: 1,
    tokenFamilyId: 'f1',
    employeeId: 'employee-1',
    organizationId,
    restaurantId: 'restaurant-1',
    branchIds: [],
    permissions: ['conversations:manage'],
    permissionsVersion: 1,
    ...overrides,
  };
}

function orgMemberActor(
  overrides: Partial<AuthenticatedOrganizationMemberActor> = {},
): AuthenticatedOrganizationMemberActor {
  return {
    actorType: AccessTokenActorType.OrganizationMember,
    userId: 'org-member-1',
    sessionId: 's1',
    sessionVersion: 1,
    tokenFamilyId: 'f1',
    organizationId,
    orgRole: OrganizationMemberRole.Owner,
    permissionsVersion: 1,
    ...overrides,
  };
}

function userActor(): AuthenticatedUserActor {
  return {
    actorType: AccessTokenActorType.User,
    userId: 'customer-1',
    sessionId: 's1',
    sessionVersion: 1,
    tokenFamilyId: 'f1',
  };
}

describe('assertActorCanManageConversation (DECISIONS.md D15 Dual Actor)', () => {
  describe('OrganizationMember', () => {
    it('allows Owner in the same organization', () => {
      expect(() =>
        assertActorCanManageConversation(
          orgMemberActor({ orgRole: OrganizationMemberRole.Owner }),
          organizationId,
          branchId,
        ),
      ).not.toThrow();
    });

    it('allows Admin in the same organization', () => {
      expect(() =>
        assertActorCanManageConversation(
          orgMemberActor({ orgRole: OrganizationMemberRole.Admin }),
          organizationId,
          branchId,
        ),
      ).not.toThrow();
    });

    it('allows access to a restaurant-wide conversation (branchId null) with no branch restriction applicable', () => {
      expect(() =>
        assertActorCanManageConversation(orgMemberActor(), organizationId, null),
      ).not.toThrow();
    });

    it('denies a non-Owner/Admin role with PermissionDeniedException (403)', () => {
      expect(() =>
        assertActorCanManageConversation(
          orgMemberActor({ orgRole: OrganizationMemberRole.Billing }),
          organizationId,
          branchId,
        ),
      ).toThrow(PermissionDeniedException);
    });

    it('denies cross-organization access with ConversationNotFoundException (404, IDOR-safe, D14)', () => {
      expect(() =>
        assertActorCanManageConversation(orgMemberActor(), otherOrganizationId, branchId),
      ).toThrow(ConversationNotFoundException);
    });
  });

  describe('Employee', () => {
    it('allows an Employee holding conversations:manage with no branch restriction (empty branchIds)', () => {
      expect(() =>
        assertActorCanManageConversation(employeeActor(), organizationId, branchId),
      ).not.toThrow();
    });

    it('allows an Employee assigned to the matching branch', () => {
      expect(() =>
        assertActorCanManageConversation(
          employeeActor({ branchIds: [branchId.value] }),
          organizationId,
          branchId,
        ),
      ).not.toThrow();
    });

    it('allows a branch-restricted Employee onto a restaurant-wide (branchId null) conversation', () => {
      expect(() =>
        assertActorCanManageConversation(
          employeeActor({ branchIds: [otherBranchId.value] }),
          organizationId,
          null,
        ),
      ).not.toThrow();
    });

    it('denies an Employee assigned only to a different branch with EmployeeBranchNotAssignedException (403)', () => {
      expect(() =>
        assertActorCanManageConversation(
          employeeActor({ branchIds: [otherBranchId.value] }),
          organizationId,
          branchId,
        ),
      ).toThrow(EmployeeBranchNotAssignedException);
    });

    it('denies an Employee missing the conversations:manage permission with PermissionDeniedException (403)', () => {
      expect(() =>
        assertActorCanManageConversation(
          employeeActor({ permissions: [] }),
          organizationId,
          branchId,
        ),
      ).toThrow(PermissionDeniedException);
    });

    it('denies cross-organization access with ConversationNotFoundException (404, IDOR-safe, D14)', () => {
      expect(() =>
        assertActorCanManageConversation(employeeActor(), otherOrganizationId, branchId),
      ).toThrow(ConversationNotFoundException);
    });
  });

  describe('User (Customer)', () => {
    it('has no legitimate claim to the Restaurant side - always denied', () => {
      expect(() => assertActorCanManageConversation(userActor(), organizationId, branchId)).toThrow(
        PermissionDeniedException,
      );
    });
  });
});

describe('resolveMessagingActorId (D3/D15)', () => {
  it("resolves an Employee actor's own employeeId", () => {
    expect(resolveMessagingActorId(employeeActor())).toBe('employee-1');
  });

  it("resolves an OrganizationMember actor's own userId", () => {
    expect(resolveMessagingActorId(orgMemberActor())).toBe('org-member-1');
  });
});

describe('resolveMessageSender (D3)', () => {
  it('Employee -> senderType Employee, senderEmployeeId set, senderUserId null', () => {
    const sender = resolveMessageSender(employeeActor());
    expect(sender).toEqual({
      senderType: MessageSenderType.Employee,
      senderUserId: null,
      senderEmployeeId: 'employee-1',
    });
  });

  it('OrganizationMember -> senderType OrganizationMember, senderUserId set, senderEmployeeId null', () => {
    const sender = resolveMessageSender(orgMemberActor());
    expect(sender).toEqual({
      senderType: MessageSenderType.OrganizationMember,
      senderUserId: 'org-member-1',
      senderEmployeeId: null,
    });
  });

  it('User (Customer) -> senderType Customer, senderUserId set, senderEmployeeId null', () => {
    const sender = resolveMessageSender(userActor());
    expect(sender).toEqual({
      senderType: MessageSenderType.Customer,
      senderUserId: 'customer-1',
      senderEmployeeId: null,
    });
  });
});
