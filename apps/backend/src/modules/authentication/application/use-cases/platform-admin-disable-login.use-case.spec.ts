import { PlatformAdminDisableLoginUseCase } from './platform-admin-disable-login.use-case';
import { UserNotFoundException } from '../exceptions/user-not-found.exception';
import { AccountLoginDisabledEvent } from '../../domain/events/authentication.events';
import { UserStatus } from '../../domain/enums/authentication.enums';
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

describe('PlatformAdminDisableLoginUseCase', () => {
  const now = new Date('2026-08-04T12:00:00.000Z');
  const targetUserId = '11111111-1111-4111-8111-111111111111';
  const adminActorId = '22222222-2222-4222-8222-222222222222';

  async function seedTargetUser(userRepository: InMemoryUserRepository): Promise<void> {
    const user = RegistrationPolicy.createPendingUser({
      id: targetUserId,
      email: Email.create('target@tavla.internal'),
      passwordHash: PasswordHash.create('argon2id$fake$hash'),
      firstName: 'Target',
      lastName: 'User',
      phone: null,
      language: 'en',
      at: now,
    }).verifyEmail(now);
    await userRepository.save(user);
  }

  function build() {
    const userRepository = new InMemoryUserRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new PlatformAdminDisableLoginUseCase(
      userRepository,
      eventPublisher,
      new FixedClock(now),
      new SequentialIdGenerator([
        'eeeeeeee-1111-4111-8111-111111111111',
        'eeeeeeee-2222-4222-8222-222222222222',
      ]),
    );
    return { useCase, userRepository, eventPublisher };
  }

  it('sets User.status to Suspended', async () => {
    const { useCase, userRepository } = build();
    await seedTargetUser(userRepository);

    await useCase.execute({ targetUserId, actorId: adminActorId });

    const updated = await userRepository.findById(UserId.create(targetUserId));
    expect(updated?.status).toBe(UserStatus.Suspended);
  });

  it('publishes AccountLoginDisabledEvent with actorId set to the PlatformAdmin', async () => {
    const { useCase, userRepository, eventPublisher } = build();
    await seedTargetUser(userRepository);

    await useCase.execute({ targetUserId, actorId: adminActorId });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as AccountLoginDisabledEvent;
    expect(event).toBeInstanceOf(AccountLoginDisabledEvent);
    expect(event.payload).toEqual({ targetUserId, actorId: adminActorId });
  });

  it('is idempotent - disabling an already-Suspended account succeeds without error', async () => {
    const { useCase, userRepository } = build();
    await seedTargetUser(userRepository);
    await useCase.execute({ targetUserId, actorId: adminActorId });

    await expect(useCase.execute({ targetUserId, actorId: adminActorId })).resolves.toBeUndefined();
  });

  it('M1: a no-op repeat call publishes no second AccountLoginDisabledEvent and writes no second audit row', async () => {
    const { useCase, userRepository, eventPublisher } = build();
    await seedTargetUser(userRepository);

    await useCase.execute({ targetUserId, actorId: adminActorId });
    expect(eventPublisher.events).toHaveLength(1);

    await useCase.execute({ targetUserId, actorId: adminActorId });
    expect(eventPublisher.events).toHaveLength(1);
  });

  it('rejects an unknown target account (IDOR-safe)', async () => {
    const { useCase } = build();

    await expect(useCase.execute({ targetUserId, actorId: adminActorId })).rejects.toThrow(
      UserNotFoundException,
    );
  });
});
