import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { OrganizationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { OrganizationMember } from '../../domain/entities/organization-member.entity';
import { OrganizationMemberRepository } from '../../domain/repositories/organization.repository';
import {
  OrganizationMemberRole,
  OrganizationMemberStatus,
} from '../../domain/enums/organization.enums';
import { OrganizationMemberPrismaMapper } from './organization-member.prisma-mapper';

@Injectable()
export class PrismaOrganizationMemberRepository implements OrganizationMemberRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findByOrganizationAndUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<OrganizationMember | null> {
    const row = await this.prismaContext.client.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: organizationId.value,
          userId: userId.value,
        },
      },
    });
    return row ? OrganizationMemberPrismaMapper.toDomain(row) : null;
  }

  async countActiveOwners(organizationId: OrganizationId): Promise<number> {
    return this.prismaContext.client.organizationMember.count({
      where: {
        organizationId: organizationId.value,
        role: OrganizationMemberRole.Owner,
        status: OrganizationMemberStatus.Active,
      },
    });
  }

  async save(member: OrganizationMember): Promise<void> {
    const data = OrganizationMemberPrismaMapper.toPersistence(member);
    await this.prismaContext.client.organizationMember.upsert({
      where: { id: data.id },
      create: data,
      update: {
        role: data.role,
        invitedAt: data.invitedAt,
        joinedAt: data.joinedAt,
        status: data.status,
        updatedAt: data.updatedAt,
      },
    });
  }
}
