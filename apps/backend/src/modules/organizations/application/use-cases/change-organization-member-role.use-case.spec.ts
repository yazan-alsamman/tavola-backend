import { ChangeOrganizationMemberRoleUseCase } from './change-organization-member-role.use-case';
import { OrganizationMemberNotFoundException } from '../../domain/exceptions/organization-member-not-found.exception';
import { OwnershipTransferRequiredException } from '../../domain/exceptions/ownership-transfer-required.exception';
import { OrganizationMemberRoleChangedEvent } from '../../domain/events/organization.events';
import { OrganizationMember } from '../../domain/entities/organization-member.entity';
import {
  OrganizationMemberRole,
  OrganizationMemberStatus,
} from '../../domain/enums/organization.enums';
import {
  CollectingEventPublisher,
  FixedClock,
  InMemoryOrganizationMemberRepository,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('ChangeOrganizationMemberRoleUseCase', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const ownerUserId = '22222222-2222-4222-8222-222222222222';
  const adminUserId = '33333333-3333-4333-8333-333333333333';
  const actorId = '44444444-4444-4444-8444-444444444444';

  function build() {
    const memberRepository = new InMemoryOrganizationMemberRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new ChangeOrganizationMemberRoleUseCase(
      memberRepository,
      new FixedClock(now),
      new SequentialIdGenerator(['eeeeeeee-1111-4111-8111-111111111111']),
      eventPublisher,
    );
    return { useCase, memberRepository, eventPublisher };
  }

  async function seedOwner(repository: InMemoryOrganizationMemberRepository) {
    await repository.save(
      OrganizationMember.create({
        id: 'member-owner',
        organizationId,
        userId: ownerUserId,
        role: OrganizationMemberRole.Owner,
        status: OrganizationMemberStatus.Active,
        invitedAt: now,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  async function seedAdmin(repository: InMemoryOrganizationMemberRepository) {
    await repository.save(
      OrganizationMember.create({
        id: 'member-admin',
        organizationId,
        userId: adminUserId,
        role: OrganizationMemberRole.Admin,
        status: OrganizationMemberStatus.Active,
        invitedAt: now,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  it('changes a non-Owner member role and publishes OrganizationMemberRoleChangedEvent', async () => {
    const { useCase, memberRepository, eventPublisher } = build();
    await seedAdmin(memberRepository);

    const result = await useCase.execute({
      organizationId,
      actorId,
      targetMemberId: 'member-admin',
      newRole: OrganizationMemberRole.Staff,
    });

    expect(result.role).toBe(OrganizationMemberRole.Staff);
    const event = eventPublisher.events[0] as OrganizationMemberRoleChangedEvent;
    expect(event).toBeInstanceOf(OrganizationMemberRoleChangedEvent);
    expect(event.payload).toMatchObject({
      organizationId,
      actorId,
      memberId: 'member-admin',
      targetUserId: adminUserId,
      previousRole: OrganizationMemberRole.Admin,
      newRole: OrganizationMemberRole.Staff,
    });
  });

  it('rejects promoting a non-Owner member TO Owner (must use Transfer Ownership)', async () => {
    const { useCase, memberRepository } = build();
    await seedAdmin(memberRepository);

    await expect(
      useCase.execute({
        organizationId,
        actorId,
        targetMemberId: 'member-admin',
        newRole: OrganizationMemberRole.Owner,
      }),
    ).rejects.toBeInstanceOf(OwnershipTransferRequiredException);
  });

  it('rejects demoting the current Owner away from Owner (must use Transfer Ownership)', async () => {
    const { useCase, memberRepository } = build();
    await seedOwner(memberRepository);

    await expect(
      useCase.execute({
        organizationId,
        actorId,
        targetMemberId: 'member-owner',
        newRole: OrganizationMemberRole.Admin,
      }),
    ).rejects.toBeInstanceOf(OwnershipTransferRequiredException);
  });

  it('rejects (404) an unknown targetMemberId', async () => {
    const { useCase } = build();

    await expect(
      useCase.execute({
        organizationId,
        actorId,
        targetMemberId: 'does-not-exist',
        newRole: OrganizationMemberRole.Staff,
      }),
    ).rejects.toBeInstanceOf(OrganizationMemberNotFoundException);
  });

  // Cross-organization IDOR protection is enforced by the Prisma tenant-
  // scoping extension (`OrganizationMember` is a `DIRECT_TENANT_OWNED_MODEL`
  // - `findById` is automatically scoped to the bound `organizationId`), not
  // by application-layer logic in this use case - the in-memory fake used
  // above has no ambient-tenant awareness, so that guarantee is proven at
  // the integration level instead (`organization-member-self-service.integration-spec.ts`),
  // against the real extension.
});
