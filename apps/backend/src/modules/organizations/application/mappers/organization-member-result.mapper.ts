import { OrganizationMember } from '../../domain/entities/organization-member.entity';
import { OrganizationMemberResult } from '../dto/organization-member.dto';

export function toOrganizationMemberResult(entity: OrganizationMember): OrganizationMemberResult {
  const props = entity.toProps();
  return {
    id: props.id,
    organizationId: props.organizationId,
    userId: props.userId,
    role: props.role,
    status: props.status,
    invitedAt: props.invitedAt,
    joinedAt: props.joinedAt,
  };
}
