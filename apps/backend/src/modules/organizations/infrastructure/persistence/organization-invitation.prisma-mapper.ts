import { OrganizationInvitation as PrismaOrganizationInvitation } from '@prisma/client';
import { OrganizationInvitation } from '../../domain/entities/organization-invitation.entity';
import {
  OrganizationMemberRole,
  OrganizationInvitationStatus,
} from '../../domain/enums/organization.enums';

export class OrganizationInvitationPrismaMapper {
  static toDomain(row: PrismaOrganizationInvitation): OrganizationInvitation {
    return OrganizationInvitation.reconstitute({
      id: row.id,
      organizationId: row.organizationId,
      email: row.email,
      role: row.role as OrganizationMemberRole,
      tokenHash: row.tokenHash,
      invitedByUserId: row.invitedByUserId,
      status: row.status as OrganizationInvitationStatus,
      expiresAt: row.expiresAt,
      acceptedAt: row.acceptedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toPersistence(invitation: OrganizationInvitation): PrismaOrganizationInvitation {
    const props = invitation.toProps();
    return {
      id: props.id,
      organizationId: props.organizationId,
      email: props.email,
      role: props.role as PrismaOrganizationInvitation['role'],
      tokenHash: props.tokenHash,
      invitedByUserId: props.invitedByUserId,
      status: props.status as PrismaOrganizationInvitation['status'],
      expiresAt: props.expiresAt,
      acceptedAt: props.acceptedAt,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    };
  }
}
