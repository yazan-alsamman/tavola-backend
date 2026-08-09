import { CancelAccountDeletionUseCase } from './cancel-account-deletion.use-case';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { InvalidAccessTokenException } from '@modules/authentication/application/exceptions/access-token.exceptions';
import { UserAccountDeletionCancelledEvent } from '@modules/authentication/domain/events/authentication.events';
import { RegistrationPolicy } from '@modules/authentication/domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  FixedClock,
  InMemoryUserRepository,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { AccountDeletionSchedulerPort } from '../ports/account-deletion-scheduler.port';

class FakeAccountDeletionScheduler implements AccountDeletionSchedulerPort {
  readonly cancelledUserIds: string[] = [];
  async scheduleAnonymization(): Promise<void> {
    throw new Error('Not needed by this suite.');
  }
  async cancelAnonymization(userId: string): Promise<void> {
    this.cancelledUserIds.push(userId);
  }
}

describe('CancelAccountDeletionUseCase', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';

  function customerActor() {
    return {
      actorType: AccessTokenActorType.User as const,
      userId,
      sessionId: '33333333-3333-4333-8333-333333333333',
      sessionVersion: 1,
      tokenFamilyId: '44444444-4444-4444-8444-444444444444',
    };
  }

  function build() {
    const userRepository = new InMemoryUserRepository();
    const scheduler = new FakeAccountDeletionScheduler();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new CancelAccountDeletionUseCase(
      userRepository,
      scheduler,
      eventPublisher,
      new FixedClock(now),
      new SequentialIdGenerator(['eeeeeeee-1111-4111-8111-111111111111']),
    );
    return { useCase, userRepository, scheduler, eventPublisher };
  }

  async function seedUserWithPendingDeletion(userRepository: InMemoryUserRepository) {
    const user = RegistrationPolicy.createPendingUser({
      id: userId,
      email: Email.create('customer@example.com'),
      passwordHash: PasswordHash.create('argon2id$fake$CurrentPass123!'),
      firstName: 'Jane',
      lastName: 'Doe',
      phone: null,
      language: 'en',
      at: now,
    })
      .verifyEmail(now)
      .requestDeletion(new Date('2026-09-09T12:00:00.000Z'), now);
    await userRepository.save(user);
  }

  it('clears the pending deletion request, cancels the BullMQ job, and publishes UserAccountDeletionCancelledEvent', async () => {
    const { useCase, userRepository, scheduler, eventPublisher } = build();
    await seedUserWithPendingDeletion(userRepository);

    await useCase.execute({ actor: customerActor() });

    const updated = await userRepository.findById(UserId.create(userId));
    expect(updated?.hasPendingDeletionRequest()).toBe(false);
    expect(scheduler.cancelledUserIds).toEqual([userId]);
    const event = eventPublisher.events[0] as UserAccountDeletionCancelledEvent;
    expect(event).toBeInstanceOf(UserAccountDeletionCancelledEvent);
    expect(event.payload).toEqual({ userId });
  });

  it('is a silent no-op when no deletion request is pending - no event, no scheduler call', async () => {
    const { useCase, userRepository, scheduler, eventPublisher } = build();
    const user = RegistrationPolicy.createPendingUser({
      id: userId,
      email: Email.create('customer@example.com'),
      passwordHash: PasswordHash.create('argon2id$fake$CurrentPass123!'),
      firstName: 'Jane',
      lastName: 'Doe',
      phone: null,
      language: 'en',
      at: now,
    }).verifyEmail(now);
    await userRepository.save(user);

    await expect(useCase.execute({ actor: customerActor() })).resolves.toBeUndefined();

    expect(scheduler.cancelledUserIds).toEqual([]);
    expect(eventPublisher.events).toHaveLength(0);
  });

  it('rejects a non-Customer actor', async () => {
    const { useCase } = build();

    await expect(
      useCase.execute({
        actor: {
          actorType: AccessTokenActorType.Employee,
          userId,
          sessionId: 's1',
          sessionVersion: 1,
          tokenFamilyId: 'f1',
          employeeId: 'e1',
          organizationId: 'o1',
          restaurantId: 'r1',
          branchIds: [],
          permissions: [],
          permissionsVersion: 1,
        },
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedException);
  });

  it('rejects an unknown user (IDOR-safe)', async () => {
    const { useCase } = build();

    await expect(useCase.execute({ actor: customerActor() })).rejects.toBeInstanceOf(
      InvalidAccessTokenException,
    );
  });
});
