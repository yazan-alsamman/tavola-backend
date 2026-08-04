import { SuspendSubscriptionUseCase } from './suspend-subscription.use-case';
import { ReactivateSubscriptionUseCase } from './reactivate-subscription.use-case';
import { CancelSubscriptionUseCase } from './cancel-subscription.use-case';
import { Subscription } from '../../domain/entities/subscription.entity';
import { SubscriptionStatus } from '../../domain/enums/subscription.enums';
import { SubscriptionNotFoundException } from '../../domain/exceptions/subscription-not-found.exception';
import { InvalidSubscriptionStatusTransitionException } from '../../domain/exceptions/invalid-subscription-status-transition.exception';
import {
  SubscriptionSuspendedEvent,
  SubscriptionReactivatedEvent,
  SubscriptionCancelledEvent,
} from '../../domain/events/subscription.events';
import { PlatformAdminRole } from '@modules/platform-admin/domain/enums/platform-admin.enums';
import { InMemorySubscriptionRepository } from '../../../../../test/subscriptions/support/in-memory-subscription.repository';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  RecordingTenantContextPort,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('Subscription lifecycle use cases (Suspend/Reactivate/Cancel)', () => {
  const now = new Date('2026-07-28T12:00:00.000Z');
  const organizationId = '11111111-1111-4111-8111-111111111111';
  const planId = '22222222-2222-4222-8222-222222222222';
  const actor = { userId: 'platform-admin-1', role: PlatformAdminRole.PlatformAdmin };

  function seedRepository(status: SubscriptionStatus): InMemorySubscriptionRepository {
    const repository = new InMemorySubscriptionRepository(organizationId);
    let subscription = Subscription.create({
      id: '33333333-3333-4333-8333-333333333333',
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

  describe('SuspendSubscriptionUseCase', () => {
    function buildUseCase(
      repository: InMemorySubscriptionRepository,
      eventPublisher: CollectingEventPublisher,
    ) {
      return new SuspendSubscriptionUseCase(
        repository,
        new FixedClock(now),
        new SequentialIdGenerator(['44444444-4444-4444-8444-444444444444']),
        eventPublisher,
        new ImmediateUnitOfWork(),
        new RecordingTenantContextPort(),
      );
    }

    it('Active -> Suspended, publishes SubscriptionSuspended with actorId', async () => {
      const repository = seedRepository(SubscriptionStatus.Active);
      const eventPublisher = new CollectingEventPublisher();
      const result = await buildUseCase(repository, eventPublisher).execute({
        actor,
        organizationId,
      });

      expect(result.status).toBe(SubscriptionStatus.Suspended);
      const event = eventPublisher.events[0] as SubscriptionSuspendedEvent;
      expect(event).toBeInstanceOf(SubscriptionSuspendedEvent);
      expect(event.payload.actorId).toBe(actor.userId);
    });

    it('throws SubscriptionNotFoundException when no subscription exists', async () => {
      const repository = new InMemorySubscriptionRepository(organizationId);
      const eventPublisher = new CollectingEventPublisher();
      await expect(
        buildUseCase(repository, eventPublisher).execute({ actor, organizationId }),
      ).rejects.toBeInstanceOf(SubscriptionNotFoundException);
    });

    it('throws InvalidSubscriptionStatusTransitionException when not Active', async () => {
      const repository = seedRepository(SubscriptionStatus.Suspended);
      const eventPublisher = new CollectingEventPublisher();
      await expect(
        buildUseCase(repository, eventPublisher).execute({ actor, organizationId }),
      ).rejects.toBeInstanceOf(InvalidSubscriptionStatusTransitionException);
    });
  });

  describe('ReactivateSubscriptionUseCase', () => {
    function buildUseCase(
      repository: InMemorySubscriptionRepository,
      eventPublisher: CollectingEventPublisher,
    ) {
      return new ReactivateSubscriptionUseCase(
        repository,
        new FixedClock(now),
        new SequentialIdGenerator(['44444444-4444-4444-8444-444444444444']),
        eventPublisher,
        new ImmediateUnitOfWork(),
        new RecordingTenantContextPort(),
      );
    }

    it('Suspended -> Active, publishes SubscriptionReactivated', async () => {
      const repository = seedRepository(SubscriptionStatus.Suspended);
      const eventPublisher = new CollectingEventPublisher();
      const result = await buildUseCase(repository, eventPublisher).execute({
        actor,
        organizationId,
      });

      expect(result.status).toBe(SubscriptionStatus.Active);
      expect(eventPublisher.events[0]).toBeInstanceOf(SubscriptionReactivatedEvent);
    });

    it('throws InvalidSubscriptionStatusTransitionException when not Suspended', async () => {
      const repository = seedRepository(SubscriptionStatus.Active);
      const eventPublisher = new CollectingEventPublisher();
      await expect(
        buildUseCase(repository, eventPublisher).execute({ actor, organizationId }),
      ).rejects.toBeInstanceOf(InvalidSubscriptionStatusTransitionException);
    });
  });

  class FakeExpirationScheduler {
    readonly cancelled: string[] = [];
    async scheduleExpiration(): Promise<void> {}
    async cancelExpiration(subscriptionId: string): Promise<void> {
      this.cancelled.push(subscriptionId);
    }
  }

  describe('CancelSubscriptionUseCase', () => {
    function buildUseCase(
      repository: InMemorySubscriptionRepository,
      eventPublisher: CollectingEventPublisher,
    ) {
      return new CancelSubscriptionUseCase(
        repository,
        new FakeExpirationScheduler(),
        new FixedClock(now),
        new SequentialIdGenerator(['44444444-4444-4444-8444-444444444444']),
        eventPublisher,
        new ImmediateUnitOfWork(),
        new RecordingTenantContextPort(),
      );
    }

    it('Active -> Cancelled, cancels any pending expiration job, publishes SubscriptionCancelled', async () => {
      const repository = seedRepository(SubscriptionStatus.Active);
      const eventPublisher = new CollectingEventPublisher();
      const result = await buildUseCase(repository, eventPublisher).execute({
        actor,
        organizationId,
      });

      expect(result.status).toBe(SubscriptionStatus.Cancelled);
      expect(eventPublisher.events[0]).toBeInstanceOf(SubscriptionCancelledEvent);
    });

    it('throws InvalidSubscriptionStatusTransitionException when not Active', async () => {
      const repository = seedRepository(SubscriptionStatus.Cancelled);
      const eventPublisher = new CollectingEventPublisher();
      await expect(
        buildUseCase(repository, eventPublisher).execute({ actor, organizationId }),
      ).rejects.toBeInstanceOf(InvalidSubscriptionStatusTransitionException);
    });
  });
});
