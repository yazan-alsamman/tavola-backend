import { OrganizationInvitation } from '../../domain/entities/organization-invitation.entity';
import { OrganizationInvitationPolicy } from '../../domain/services/organization-invitation-policy';
import { OrganizationInvitationResult } from '../dto/organization-invitation.dto';

export function toOrganizationInvitationResult(
  entity: OrganizationInvitation,
  now: Date,
): OrganizationInvitationResult {
  const props = entity.toProps();
  return {
    id: props.id,
    organizationId: props.organizationId,
    email: props.email,
    role: props.role,
    status: OrganizationInvitationPolicy.resolveState(entity, now),
    invitedByUserId: props.invitedByUserId,
    expiresAt: props.expiresAt,
    acceptedAt: props.acceptedAt,
    createdAt: props.createdAt,
  };
}
