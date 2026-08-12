import { ListOrganizationMembersUseCase } from './list-organization-members.use-case';
import { OrganizationMember } from '../../domain/entities/organization-member.entity';
import {
  OrganizationMemberRole,
  OrganizationMemberStatus,
} from '../../domain/enums/organization.enums';
import { InMemoryOrganizationMemberRepository } from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('ListOrganizationMembersUseCase', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';

  function build() {
    const memberRepository = new InMemoryOrganizationMemberRepository();
    return { useCase: new ListOrganizationMembersUseCase(memberRepository), memberRepository };
  }

  it('returns an empty page when the Organization has no members', async () => {
    const { useCase } = build();

    const result = await useCase.execute({ page: 1, limit: 20 });

    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
  });

  it('lists members and paginates', async () => {
    const { useCase, memberRepository } = build();
    for (let i = 0; i < 3; i += 1) {
      await memberRepository.save(
        OrganizationMember.create({
          id: `member-${i}`,
          organizationId,
          userId: `2222222${i}-2222-4222-8222-222222222222`,
          role: OrganizationMemberRole.Staff,
          status: OrganizationMemberStatus.Active,
          invitedAt: now,
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    const page1 = await useCase.execute({ page: 1, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(3);

    const page2 = await useCase.execute({ page: 2, limit: 2 });
    expect(page2.items).toHaveLength(1);
    expect(page2.total).toBe(3);
  });
});
