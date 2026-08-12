import { OrganizationMemberRole } from '../../domain/enums/organization.enums';
import { OrganizationInvitationState } from '../../domain/services/organization-invitation-policy';

export interface OrganizationInvitationResult {
  id: string;
  organizationId: string;
  email: string;
  role: OrganizationMemberRole;
  /** Live-resolved state (Section 2/3) - `'expired'` is never a persisted DB value. */
  status: OrganizationInvitationState;
  invitedByUserId: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
}

export interface IssueOrganizationInvitationCommand {
  organizationId: string;
  actorId: string;
  email: string;
  role: OrganizationMemberRole;
  correlationId?: string;
}

export interface ListOrganizationInvitationsQuery {
  organizationId: string;
  page: number;
  limit: number;
}

export interface ListOrganizationInvitationsResult {
  items: OrganizationInvitationResult[];
  total: number;
  page: number;
  limit: number;
}

export interface RevokeOrganizationInvitationCommand {
  organizationId: string;
  actorId: string;
  invitationId: string;
  correlationId?: string;
}

export interface AcceptOrganizationInvitationCommand {
  token: string;
  /** Resolved by the controller from an optional Bearer token on this otherwise-public route (Section 7) - `null` for an anonymous caller. */
  authenticatedUserId: string | null;
  /** New-account branch only (Section 8) - ignored (and must be absent) when the invited email already has an account. */
  firstName?: string;
  lastName?: string;
  password?: string;
  correlationId?: string;
}

export interface AcceptOrganizationInvitationResult {
  organizationId: string;
  memberId: string;
  userId: string;
  role: OrganizationMemberRole;
  accountCreated: boolean;
}
