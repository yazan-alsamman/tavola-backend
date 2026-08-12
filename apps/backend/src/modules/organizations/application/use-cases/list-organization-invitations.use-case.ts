import { Inject, Injectable } from '@nestjs/common';
import { OrganizationId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { OrganizationInvitationRepository } from '../../domain/repositories/organization.repository';
import { ORGANIZATION_INVITATION_REPOSITORY } from '../tokens/organizations.tokens';
import {
  ListOrganizationInvitationsQuery,
  ListOrganizationInvitationsResult,
} from '../dto/organization-invitation.dto';
import { toOrganizationInvitationResult } from '../mappers/organization-invitation-result.mapper';

/** Phase 19.8 (Owner Invite, ADR-036). Owner/Admin only, same guard chain as `ListOrganizationMembersUseCase`. */
@Injectable()
export class ListOrganizationInvitationsUseCase {
  constructor(
    @Inject(ORGANIZATION_INVITATION_REPOSITORY)
    private readonly invitationRepository: OrganizationInvitationRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(
    query: ListOrganizationInvitationsQuery,
  ): Promise<ListOrganizationInvitationsResult> {
    const organizationId = OrganizationId.create(query.organizationId);
    const now = this.clock.now();
    const { items, total } = await this.invitationRepository.listByOrganization(
      organizationId,
      query.page,
      query.limit,
    );
    return {
      items: items.map((item) => toOrganizationInvitationResult(item, now)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}
