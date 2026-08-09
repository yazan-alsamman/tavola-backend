import { PlatformAdminTransferOrganizationOwnershipUseCase } from './platform-admin-transfer-organization-ownership.use-case';
import { OrganizationMemberNotFoundException } from '../../domain/exceptions/organization-member-not-found.exception';
import { OwnershipTransferConflictException } from '../../domain/exceptions/ownership-transfer-conflict.exception';
import { OrganizationOwnershipTransferredEvent } from '../../domain/events/organization.events';
import { OrganizationMember } from '../../domain/entities/organization-member.entity';
import {
  OrganizationMemberRole,
  OrganizationMemberStatus,
} from '../../domain/enums/organization.enums';
import { OrganizationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryOrganizationMemberRepository,
  RecordingTenantContextPort,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

/**
 * M2 remediation coverage - simulates a concurrent transfer winning the race
 * between this use case's `findOwner` read and its CAS write, by demoting
 * the current Owner (as `OrganizationMembershipPolicy.transferOwnership`
 * itself would) the moment the use case makes its *second* read
 * (`findByOrganizationAndUser` for the target member). The use case's own
 * `updateRoleIfRole` CAS guard is exercised completely unmodified.
 */
class RaceConditionMemberRepository extends InMemoryOrganizationMemberRepository {
  private raceTriggered = false;

  async findByOrganizationAndUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<OrganizationMember | null> {
    const result = await super.findByOrganizationAndUser(organizationId, userId);
    if (!this.raceTriggered) {
      this.raceTriggered = true;
      const owner = await super.findOwner(organizationId);
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

describe('PlatformAdminTransferOrganizationOwnershipUseCase', () => {
  const now = new Date('2026-08-04T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const currentOwnerUserId = '22222222-2222-4222-8222-222222222222';
  const newOwnerUserId = '33333333-3333-4333-8333-333333333333';
  const actorId = '44444444-4444-4444-8444-444444444444';

  function build() {
    const memberRepository = new InMemoryOrganizationMemberRepository();
    const tenantContext = new RecordingTenantContextPort();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new PlatformAdminTransferOrganizationOwnershipUseCase(
      memberRepository,
      tenantContext,
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
  ): Promise<void> {
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
        userId: newOwnerUserId,
        role: OrganizationMemberRole.Admin,
        status: targetStatus,
        invitedAt: now,
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  it("resolves OwnershipTransferRequiredException's previously unsatisfiable precondition: demotes the current owner to Admin and promotes the target to Owner", async () => {
    const { useCase, memberRepository } = build();
    await seedMembers(memberRepository);

    const result = await useCase.execute({ organizationId, newOwnerUserId, actorId });

    expect(result).toEqual({
      organizationId,
      previousOwnerUserId: currentOwnerUserId,
      newOwnerUserId,
    });
    const owner = await memberRepository.findOwner(OrganizationId.create(organizationId));
    expect(owner?.userId.value).toBe(newOwnerUserId);
  });

  it('publishes OrganizationOwnershipTransferredEvent', async () => {
    const { useCase, memberRepository, eventPublisher } = build();
    await seedMembers(memberRepository);

    await useCase.execute({ organizationId, newOwnerUserId, actorId });

    const event = eventPublisher.events[0] as OrganizationOwnershipTransferredEvent;
    expect(event).toBeInstanceOf(OrganizationOwnershipTransferredEvent);
    expect(event.payload).toMatchObject({
      organizationId,
      actorId,
      previousOwnerUserId: currentOwnerUserId,
      newOwnerUserId,
    });
  });

  it('rejects (409) a target member who is not Active', async () => {
    const { useCase, memberRepository } = build();
    await seedMembers(memberRepository, OrganizationMemberStatus.Invited);

    await expect(useCase.execute({ organizationId, newOwnerUserId, actorId })).rejects.toThrow(
      OwnershipTransferConflictException,
    );
  });

  it('rejects (404) a target user who is not a member of this Organization (IDOR-safe)', async () => {
    const { useCase, memberRepository } = build();
    await seedMembers(memberRepository);
    const notAMemberUserId = '55555555-5555-4555-8555-555555555555';

    await expect(
      useCase.execute({ organizationId, newOwnerUserId: notAMemberUserId, actorId }),
    ).rejects.toThrow(OrganizationMemberNotFoundException);
  });

  it('rejects (404) when the Organization has no current Owner', async () => {
    const { useCase } = build();

    await expect(useCase.execute({ organizationId, newOwnerUserId, actorId })).rejects.toThrow(
      OrganizationMemberNotFoundException,
    );
  });

  it('M2: rejects (409) when a concurrent transfer already moved the current Owner away from Owner between read and write - preserves the single-Owner invariant instead of creating two Active Owners', async () => {
    const memberRepository = new RaceConditionMemberRepository();
    const tenantContext = new RecordingTenantContextPort();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new PlatformAdminTransferOrganizationOwnershipUseCase(
      memberRepository,
      tenantContext,
      new ImmediateUnitOfWork(),
      new FixedClock(now),
      new SequentialIdGenerator(['eeeeeeee-1111-4111-8111-111111111111']),
      eventPublisher,
    );
    await seedMembers(memberRepository);

    await expect(useCase.execute({ organizationId, newOwnerUserId, actorId })).rejects.toThrow(
      OwnershipTransferConflictException,
    );

    // The target member was never promoted - no second Active Owner exists.
    const target = await memberRepository.findByOrganizationAndUser(
      OrganizationId.create(organizationId),
      UserId.create(newOwnerUserId),
    );
    expect(target?.role).toBe(OrganizationMemberRole.Admin);
    expect(eventPublisher.events).toHaveLength(0);
  });
});
