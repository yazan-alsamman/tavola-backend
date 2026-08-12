import { Injectable, Inject } from '@nestjs/common';
import { OrganizationMemberRepository } from '../../domain/repositories/organization.repository';
import { ORGANIZATION_MEMBER_REPOSITORY } from '../tokens/organizations.tokens';
import {
  ListOrganizationMembersQuery,
  ListOrganizationMembersResult,
} from '../dto/organization-member.dto';
import { toOrganizationMemberResult } from '../mappers/organization-member-result.mapper';

/**
 * Phase 19.7 - a minimal, necessary companion read: Change-Role/Remove/
 * Transfer all target an existing member by id, so an Owner/Admin needs a
 * way to discover those ids first. Owner/Admin only (same tier as the three
 * mutations, not exposed to Staff/Billing), tenant-scoped implicitly via
 * `OrganizationMemberRepository.listByOrganization`'s ambient Tenant Context
 * (`OrganizationMember` is a `DIRECT_TENANT_OWNED_MODEL`).
 */
@Injectable()
export class ListOrganizationMembersUseCase {
  constructor(
    @Inject(ORGANIZATION_MEMBER_REPOSITORY)
    private readonly organizationMemberRepository: OrganizationMemberRepository,
  ) {}

  async execute(query: ListOrganizationMembersQuery): Promise<ListOrganizationMembersResult> {
    const { items, total } = await this.organizationMemberRepository.listByOrganization(
      query.page,
      query.limit,
    );
    return {
      items: items.map(toOrganizationMemberResult),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}
