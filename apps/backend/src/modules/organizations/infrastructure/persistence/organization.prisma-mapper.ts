import { Organization as PrismaOrganization } from '@prisma/client';
import { Organization } from '../../domain/entities/organization.entity';
import { OrganizationStatus } from '../../domain/enums/organization.enums';

export class OrganizationPrismaMapper {
  static toDomain(row: PrismaOrganization): Organization {
    return Organization.reconstitute({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status as OrganizationStatus,
      billingEmail: row.billingEmail,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }

  static toPersistence(organization: Organization): PrismaOrganization {
    const props = organization.toProps();
    return {
      id: props.id,
      name: props.name,
      slug: props.slug,
      status: props.status as PrismaOrganization['status'],
      billingEmail: props.billingEmail,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      deletedAt: props.deletedAt,
    };
  }
}
