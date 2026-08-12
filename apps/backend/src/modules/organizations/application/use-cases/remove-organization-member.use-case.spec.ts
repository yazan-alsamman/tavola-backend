import { RemoveOrganizationMemberUseCase } from './remove-organization-member.use-case';
import { OrganizationMemberNotFoundException } from '../../domain/exceptions/organization-member-not-found.exception';
import { SoleOwnerRemovalException } from '../../domain/exceptions/sole-owner-removal.exception';
import { OrganizationMemberRemovedEvent } from '../../domain/events/organization.events';
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

describe('RemoveOrganizationMemberUseCase', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const ownerUserId = '22222222-2222-4222-8222-222222222222';
  const staffUserId = '33333333-3333-4333-8333-333333333333';
  const actorId = '44444444-4444-4444-8444-444444444444';

  function build(ids: string[] = ['eeeeeeee-1111-4111-8111-111111111111']) {
    const memberRepository = new InMemoryOrganizationMemberRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new RemoveOrganizationMemberUseCase(
      memberRepository,
      new FixedClock(now),
      new SequentialIdGenerator(ids),
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

  async function seedStaff(repository: InMemoryOrganizationMemberRepository) {
    await repository.save(
      OrganizationMember.create({
        id: 'member-staff',
        organizationId,
        userId: staffUserId,
        role: OrganizationMemberRole.Staff,
        status: OrganizationMemberStatus.Active,
        invitedAt: now,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  it('removes a non-Owner member (status -> Removed) and publishes OrganizationMemberRemovedEvent', async () => {
    const { useCase, memberRepository, eventPublisher } = build();
    await seedOwner(memberRepository);
    await seedStaff(memberRepository);

    const result = await useCase.execute({
      organizationId,
      actorId,
      targetMemberId: 'member-staff',
    });

    expect(result.status).toBe(OrganizationMemberStatus.Removed);
    const event = eventPublisher.events[0] as OrganizationMemberRemovedEvent;
    expect(event).toBeInstanceOf(OrganizationMemberRemovedEvent);
    expect(event.payload).toMatchObject({
      organizationId,
      actorId,
      memberId: 'member-staff',
      targetUserId: staffUserId,
    });
  });

  it('rejects removing the sole Active Owner (403)', async () => {
    const { useCase, memberRepository } = build();
    await seedOwner(memberRepository);

    await expect(
      useCase.execute({ organizationId, actorId, targetMemberId: 'member-owner' }),
    ).rejects.toBeInstanceOf(SoleOwnerRemovalException);
  });

  it('rejects (404) an unknown targetMemberId', async () => {
    const { useCase } = build();

    await expect(
      useCase.execute({ organizationId, actorId, targetMemberId: 'does-not-exist' }),
    ).rejects.toBeInstanceOf(OrganizationMemberNotFoundException);
  });

  it('re-removing an already-Removed member is idempotent (no error, status stays Removed)', async () => {
    const { useCase, memberRepository } = build([
      'eeeeeeee-1111-4111-8111-111111111111',
      'eeeeeeee-2222-4222-8222-222222222222',
    ]);
    await seedOwner(memberRepository);
    await seedStaff(memberRepository);
    await useCase.execute({ organizationId, actorId, targetMemberId: 'member-staff' });

    const result = await useCase.execute({
      organizationId,
      actorId,
      targetMemberId: 'member-staff',
    });

    expect(result.status).toBe(OrganizationMemberStatus.Removed);
  });
});
