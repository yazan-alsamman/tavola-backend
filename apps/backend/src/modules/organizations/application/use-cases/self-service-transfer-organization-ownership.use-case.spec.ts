import { SelfServiceTransferOrganizationOwnershipUseCase } from './self-service-transfer-organization-ownership.use-case';
import { OrganizationMemberNotFoundException } from '../../domain/exceptions/organization-member-not-found.exception';
import { OwnershipTransferConflictException } from '../../domain/exceptions/ownership-transfer-conflict.exception';
import { OrganizationOwnershipTransferredEvent } from '../../domain/events/organization.events';
import { OrganizationMember } from '../../domain/entities/organization-member.entity';
import { OrganizationId } from '@shared/domain/value-objects/identifiers.vo';
import {
  OrganizationMemberRole,
  OrganizationMemberStatus,
} from '../../domain/enums/organization.enums';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryOrganizationMemberRepository,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

/**
 * Atomicity/rollback coverage mirroring
 * `PlatformAdminTransferOrganizationOwnershipUseCase.spec.ts`'s own
 * `RaceConditionMemberRepository` technique, adapted to this use case's
 * `findById` (not `findByOrganizationAndUser`) target-resolution call.
 */
class RaceConditionMemberRepository extends InMemoryOrganizationMemberRepository {
  private raceTriggered = false;

  async findById(id: string): Promise<OrganizationMember | null> {
    const result = await super.findById(id);
    if (!this.raceTriggered) {
      this.raceTriggered = true;
      const owner = await super.findOwner(OrganizationId.create(result!.toProps().organizationId));
      if (owner) {
        await super.save(
          OrganizationMember.reconstitute({
            ...owner.toProps(),
            role: OrganizationMemberRole.Admin,
          }),
        );
      }
    }
    return result;
  }
}

describe('SelfServiceTransferOrganizationOwnershipUseCase', () => {
  const now = new Date('2026-08-11T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const currentOwnerUserId = '22222222-2222-4222-8222-222222222222';
  const targetUserId = '33333333-3333-4333-8333-333333333333';

  function build(memberRepository = new InMemoryOrganizationMemberRepository()) {
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new SelfServiceTransferOrganizationOwnershipUseCase(
      memberRepository,
      new ImmediateUnitOfWork(),
      new FixedClock(now),
      new SequentialIdGenerator(['eeeeeeee-1111-4111-8111-111111111111']),
      eventPublisher,
    );
    return { useCase, memberRepository, eventPublisher };
  }

  async function seedMembers(
    repository: InMemoryOrganizationMemberRepository,
    targetStatus: OrganizationMemberStatus = OrganizationMemberStatus.Active,
  ) {
    await repository.save(
      OrganizationMember.create({
        id: 'member-owner',
        organizationId,
        userId: currentOwnerUserId,
        role: OrganizationMemberRole.Owner,
        status: OrganizationMemberStatus.Active,
        invitedAt: now,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await repository.save(
      OrganizationMember.create({
        id: 'member-target',
        organizationId,
        userId: targetUserId,
        role: OrganizationMemberRole.Admin,
        status: targetStatus,
        invitedAt: now,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  it('demotes the current owner to Admin and promotes the target to Owner (atomically)', async () => {
    const { useCase, memberRepository } = build();
    await seedMembers(memberRepository);

    const result = await useCase.execute({
      organizationId,
      actorId: currentOwnerUserId,
      targetMemberId: 'member-target',
    });

    expect(result).toEqual({
      organizationId,
      previousOwnerUserId: currentOwnerUserId,
      newOwnerUserId: targetUserId,
    });
    const owner = await memberRepository.findOwner(OrganizationId.create(organizationId));
    expect(owner?.userId.value).toBe(targetUserId);
  });

  it('publishes OrganizationOwnershipTransferredEvent (the same event PlatformAdmin transfer already produces)', async () => {
    const { useCase, memberRepository, eventPublisher } = build();
    await seedMembers(memberRepository);

    await useCase.execute({
      organizationId,
      actorId: currentOwnerUserId,
      targetMemberId: 'member-target',
    });

    const event = eventPublisher.events[0] as OrganizationOwnershipTransferredEvent;
    expect(event).toBeInstanceOf(OrganizationOwnershipTransferredEvent);
    expect(event.payload).toMatchObject({
      organizationId,
      actorId: currentOwnerUserId,
      previousOwnerUserId: currentOwnerUserId,
      newOwnerUserId: targetUserId,
    });
  });

  it('rejects (409) a target member who is not Active', async () => {
    const { useCase, memberRepository } = build();
    await seedMembers(memberRepository, OrganizationMemberStatus.Invited);

    await expect(
      useCase.execute({
        organizationId,
        actorId: currentOwnerUserId,
        targetMemberId: 'member-target',
      }),
    ).rejects.toBeInstanceOf(OwnershipTransferConflictException);
  });

  it('rejects (404) an unknown targetMemberId', async () => {
    const { useCase, memberRepository } = build();
    await seedMembers(memberRepository);

    await expect(
      useCase.execute({
        organizationId,
        actorId: currentOwnerUserId,
        targetMemberId: 'does-not-exist',
      }),
    ).rejects.toBeInstanceOf(OrganizationMemberNotFoundException);
  });

  it('rejects (404) when the Organization has no current Owner', async () => {
    const { useCase } = build();

    await expect(
      useCase.execute({
        organizationId,
        actorId: currentOwnerUserId,
        targetMemberId: 'member-target',
      }),
    ).rejects.toBeInstanceOf(OrganizationMemberNotFoundException);
  });

  it('rejects (409) when the caller is no longer the current Owner (stale token)', async () => {
    const { useCase, memberRepository } = build();
    await seedMembers(memberRepository);
    const impostorUserId = '55555555-5555-4555-8555-555555555555';

    await expect(
      useCase.execute({
        organizationId,
        actorId: impostorUserId,
        targetMemberId: 'member-target',
      }),
    ).rejects.toBeInstanceOf(OwnershipTransferConflictException);
  });

  it('preserves the single-Owner invariant under a concurrent transfer race (rollback: target never promoted)', async () => {
    const memberRepository = new RaceConditionMemberRepository();
    const { useCase, eventPublisher } = build(memberRepository);
    await seedMembers(memberRepository);

    await expect(
      useCase.execute({
        organizationId,
        actorId: currentOwnerUserId,
        targetMemberId: 'member-target',
      }),
    ).rejects.toBeInstanceOf(OwnershipTransferConflictException);

    const target = await memberRepository.findById('member-target');
    expect(target?.role).toBe(OrganizationMemberRole.Admin);
    expect(eventPublisher.events).toHaveLength(0);
  });
});
