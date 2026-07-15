import { OrganizationMember as PrismaOrganizationMember } from '@prisma/client';
import { OrganizationMember } from '../../domain/entities/organization-member.entity';
import {
  OrganizationMemberRole,
  OrganizationMemberStatus,
} from '../../domain/enums/organization.enums';

export class OrganizationMemberPrismaMapper {
  static toDomain(row: PrismaOrganizationMember): OrganizationMember {
    return OrganizationMember.reconstitute({
      id: row.id,
      organizationId: row.organizationId,
      userId: row.userId,
      role: row.role as OrganizationMemberRole,
      invitedAt: row.invitedAt,
      joinedAt: row.joinedAt,
      status: row.status as OrganizationMemberStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toPersistence(member: OrganizationMember): PrismaOrganizationMember {
    const props = member.toProps();
    return {
      id: props.id,
      organizationId: props.organizationId,
      userId: props.userId,
      role: props.role as PrismaOrganizationMember['role'],
      invitedAt: props.invitedAt,
      joinedAt: props.joinedAt,
      status: props.status as PrismaOrganizationMember['status'],
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    };
  }
}
