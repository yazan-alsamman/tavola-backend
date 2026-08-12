import {
  OrganizationMemberRole,
  OrganizationMemberStatus,
} from '../../domain/enums/organization.enums';

export interface OrganizationMemberResult {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationMemberRole;
  status: OrganizationMemberStatus;
  invitedAt: Date | null;
  joinedAt: Date | null;
}

export interface ChangeOrganizationMemberRoleCommand {
  organizationId: string;
  actorId: string;
  targetMemberId: string;
  newRole: OrganizationMemberRole;
  correlationId?: string;
}

export interface RemoveOrganizationMemberCommand {
  organizationId: string;
  actorId: string;
  targetMemberId: string;
  correlationId?: string;
}

export interface SelfServiceTransferOwnershipCommand {
  organizationId: string;
  actorId: string;
  targetMemberId: string;
  correlationId?: string;
}

export interface ListOrganizationMembersQuery {
  page: number;
  limit: number;
}

export interface ListOrganizationMembersResult {
  items: OrganizationMemberResult[];
  total: number;
  page: number;
  limit: number;
}
