import { SuspendSubscriptionUseCase } from './suspend-subscription.use-case';
import { Subscription } from '../../domain/entities/subscription.entity';
import { SubscriptionStatus } from '../../domain/enums/subscription.enums';
import { SubscriptionNotFoundException } from '../../domain/exceptions/subscription-not-found.exception';
import { InvalidSubscriptionStatusTransitionException } from '../../domain/exceptions/invalid-subscription-status-transition.exception';
import { SubscriptionSuspendedEvent } from '../../domain/events/subscription.events';
import { InMemorySubscriptionRepository } from '../../../../../test/subscriptions/support/in-memory-subscription.repository';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  RecordingTenantContextPort,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('SuspendSubscriptionUseCase', () => {
  const now = new Date('2026-07-28T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const planId = '22222222-2222-4222-8222-222222222222';
  const subscriptionId = '33333333-3333-4333-8333-333333333333';
  const actor = { userId: 'platform-admin-1' };

  function seedRepository(status: SubscriptionStatus): InMemorySubscriptionRepository {
    const repository = new InMemorySubscriptionRepository(organizationId);
    let subscription = Subscription.create({
      id: subscriptionId,
      organizationId,
      subscriptionPlanId: planId,
      startsAt: now,
      now,
    });
    if (status === SubscriptionStatus.Suspended) {
      subscription = subscription.suspend(now);
    } else if (status === SubscriptionStatus.Cancelled) {
      subscription = subscription.cancel(now);
    }
    void repository.create(subscription);
    return repository;
  }

  function build(repository: InMemorySubscriptionRepository) {
    const eventPublisher = new CollectingEventPublisher();
    const tenantContext = new RecordingTenantContextPort();
    const useCase = new SuspendSubscriptionUseCase(
      repository,
      new FixedClock(now),
      new SequentialIdGenerator(['44444444-4444-4444-8444-444444444444']),
      eventPublisher,
      new ImmediateUnitOfWork(),
      tenantContext,
    );
    return { useCase, eventPublisher, tenantContext };
  }

  it('Active -> Suspended, publishes SubscriptionSuspended with actorId', async () => {
    const repository = seedRepository(SubscriptionStatus.Active);
    const { useCase, eventPublisher } = build(repository);

    const result = await useCase.execute({ actor, organizationId });

    expect(result.status).toBe(SubscriptionStatus.Suspended);
    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as SubscriptionSuspendedEvent;
    expect(event).toBeInstanceOf(SubscriptionSuspendedEvent);
    expect(event.payload).toMatchObject({ subscriptionId, organizationId, actorId: actor.userId });
  });

  it('binds TenantContext to the target organizationId before touching the repository', async () => {
    const repository = seedRepository(SubscriptionStatus.Active);
    const { useCase, tenantContext } = build(repository);

    await useCase.execute({ actor, organizationId });

    expect(tenantContext.boundContexts[0].organizationId).toBe(organizationId);
  });

  it('throws SubscriptionNotFoundException when no subscription exists for the organization', async () => {
    const repository = new InMemorySubscriptionRepository(organizationId);
    const { useCase } = build(repository);

    await expect(useCase.execute({ actor, organizationId })).rejects.toBeInstanceOf(
      SubscriptionNotFoundException,
    );
  });

  it('rejects suspending an already-Suspended subscription', async () => {
    const repository = seedRepository(SubscriptionStatus.Suspended);
    const { useCase, eventPublisher } = build(repository);

    await expect(useCase.execute({ actor, organizationId })).rejects.toBeInstanceOf(
      InvalidSubscriptionStatusTransitionException,
    );
    expect(eventPublisher.events).toHaveLength(0);
  });

  it('rejects suspending a Cancelled subscription', async () => {
    const repository = seedRepository(SubscriptionStatus.Cancelled);
    const { useCase, eventPublisher } = build(repository);

    await expect(useCase.execute({ actor, organizationId })).rejects.toBeInstanceOf(
      InvalidSubscriptionStatusTransitionException,
    );
    expect(eventPublisher.events).toHaveLength(0);
  });
});
