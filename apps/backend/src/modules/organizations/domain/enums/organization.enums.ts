export enum OrganizationStatus {
  Active = 'Active',
  Suspended = 'Suspended',
  Closed = 'Closed',
}

export enum OrganizationMemberRole {
  Owner = 'Owner',
  Admin = 'Admin',
  Billing = 'Billing',
  Staff = 'Staff',
}

export enum OrganizationMemberStatus {
  Invited = 'Invited',
  Active = 'Active',
  Removed = 'Removed',
}

/**
 * Phase 19.8 (Owner Invite, ADR-036). "Expired" is deliberately not a member
 * here - see schema.prisma's OrganizationInvitationStatus comment for why.
 */
export enum OrganizationInvitationStatus {
  Pending = 'Pending',
  Accepted = 'Accepted',
  Revoked = 'Revoked',
}
