import { Email } from '@shared/domain/value-objects/email.vo';
import { OrganizationSlug } from '@shared/domain/value-objects/organization-slug.vo';
import { Organization } from '../entities/organization.entity';
import { OrganizationStatus } from '../enums/organization.enums';

export interface CreateOrganizationForOwnerInput {
  id: string;
  name: string;
  slug: OrganizationSlug;
  billingEmail: Email;
  at: Date;
}

export class OrganizationRegistrationPolicy {
  static createForOwner(input: CreateOrganizationForOwnerInput): Organization {
    return Organization.create({
      id: input.id,
      name: input.name.trim(),
      slug: input.slug.value,
      status: OrganizationStatus.Active,
      billingEmail: input.billingEmail.value,
      createdAt: input.at,
      updatedAt: input.at,
      deletedAt: null,
    });
  }
}
