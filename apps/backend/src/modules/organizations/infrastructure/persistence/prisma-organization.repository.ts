import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { OrganizationId } from '@shared/domain/value-objects/identifiers.vo';
import { OrganizationSlug } from '@shared/domain/value-objects/organization-slug.vo';
import { Organization } from '../../domain/entities/organization.entity';
import { OrganizationRepository } from '../../domain/repositories/organization.repository';
import { OrganizationPrismaMapper } from './organization.prisma-mapper';

@Injectable()
export class PrismaOrganizationRepository implements OrganizationRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findById(id: OrganizationId): Promise<Organization | null> {
    const row = await this.prismaContext.client.organization.findUnique({
      where: { id: id.value },
    });
    return row ? OrganizationPrismaMapper.toDomain(row) : null;
  }

  async findBySlug(slug: OrganizationSlug): Promise<Organization | null> {
    const row = await this.prismaContext.client.organization.findFirst({
      where: { slug: slug.value, deletedAt: null },
    });
    return row ? OrganizationPrismaMapper.toDomain(row) : null;
  }

  async save(organization: Organization): Promise<void> {
    const data = OrganizationPrismaMapper.toPersistence(organization);
    await this.prismaContext.client.organization.upsert({
      where: { id: data.id },
      create: data,
      update: {
        name: data.name,
        slug: data.slug,
        status: data.status,
        billingEmail: data.billingEmail,
        updatedAt: data.updatedAt,
        deletedAt: data.deletedAt,
      },
    });
  }
}
