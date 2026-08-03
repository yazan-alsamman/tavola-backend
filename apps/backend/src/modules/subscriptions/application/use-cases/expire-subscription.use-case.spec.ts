import { ExpireSubscriptionUseCase } from './expire-subscription.use-case';
import { Subscription } from '../../domain/entities/subscription.entity';
import { SubscriptionStatus } from '../../domain/enums/subscription.enums';
import { SubscriptionExpiredEvent } from '../../domain/events/subscription.events';
import { InMemorySubscriptionRepository } from '../../../../../test/subscriptions/support/in-memory-subscription.repository';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';

describe('ExpireSubscriptionUseCase', () => {
  const now = new Date('2026-07-28T12:00:00.000Z');
  const endsAt = new Date('2026-07-28T10:00:00.000Z');
  const subscriptionId = '11111111-1111-4111-8111-111111111111';
  const organizationId = '22222222-2222-4222-8222-222222222222';
  const planId = '33333333-3333-4333-8333-333333333333';

  function build() {
    const subscriptionRepository = new InMemorySubscriptionRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new ExpireSubscriptionUseCase(
      subscriptionRepository,
      new FixedClock(now),
      new SequentialIdGenerator([
        '44444444-4444-4444-8444-444444444444',
        '55555555-5555-4555-8555-555555555555',
      ]),
      eventPublisher,
      new ImmediateUnitOfWork(),
      new TenantContextService(),
    );
    return { useCase, subscriptionRepository, eventPublisher };
  }

  it('Active + endsAt elapsed -> Expired, publishes SubscriptionExpired (System actor, no actorId)', async () => {
    const { useCase, subscriptionRepository, eventPublisher } = build();
    const subscription = Subscription.create({
      id: subscriptionId,
      organizationId,
      subscriptionPlanId: planId,
      startsAt: now,
      endsAt,
      now,
    });
    await subscriptionRepository.create(subscription);

    await useCase.execute({ subscriptionId, organizationId });

    const stored = await subscriptionRepository.findById(subscription.subscriptionId);
    expect(stored?.status).toBe(SubscriptionStatus.Expired);
    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(SubscriptionExpiredEvent);
  });

  it('idempotent: a second execution against an already-Expired subscription is a safe no-op (CAS replay safety)', async () => {
    const { useCase, subscriptionRepository, eventPublisher } = build();
    const subscription = Subscription.create({
      id: subscriptionId,
      organizationId,
      subscriptionPlanId: planId,
      startsAt: now,
      endsAt,
      now,
    });
    await subscriptionRepository.create(subscription);

    await useCase.execute({ subscriptionId, organizationId });
    await useCase.execute({ subscriptionId, organizationId });

    expect(eventPublisher.events).toHaveLength(1);
  });

  it('no-op when the subscription is not Active (e.g. already Cancelled by an admin before the delayed job fired)', async () => {
    const { useCase, subscriptionRepository, eventPublisher } = build();
    const subscription = Subscription.create({
      id: subscriptionId,
      organizationId,
      subscriptionPlanId: planId,
      startsAt: now,
      endsAt,
      now,
    }).cancel(now);
    await subscriptionRepository.create(subscription);

    await useCase.execute({ subscriptionId, organizationId });

    const stored = await subscriptionRepository.findById(subscription.subscriptionId);
    expect(stored?.status).toBe(SubscriptionStatus.Cancelled);
    expect(eventPublisher.events).toHaveLength(0);
  });

  it('no-op when the subscription no longer exists', async () => {
    const { useCase, eventPublisher } = build();
    await expect(
      useCase.execute({ subscriptionId: '99999999-9999-4999-8999-999999999999', organizationId }),
    ).resolves.toBeUndefined();
    expect(eventPublisher.events).toHaveLength(0);
  });
});
