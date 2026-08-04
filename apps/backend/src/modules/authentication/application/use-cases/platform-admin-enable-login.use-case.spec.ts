import { PlatformAdminEnableLoginUseCase } from './platform-admin-enable-login.use-case';
import { UserNotFoundException } from '../exceptions/user-not-found.exception';
import { AccountNotDisabledException } from '../../domain/exceptions/account-not-disabled.exception';
import { AccountLoginEnabledEvent } from '../../domain/events/authentication.events';
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

describe('PlatformAdminEnableLoginUseCase', () => {
  const now = new Date('2026-08-04T12:00:00.000Z');
  const targetUserId = '11111111-1111-4111-8111-111111111111';
  const adminActorId = '22222222-2222-4222-8222-222222222222';

  async function seedTargetUser(
    userRepository: InMemoryUserRepository,
    status: UserStatus,
  ): Promise<void> {
    const pending = RegistrationPolicy.createPendingUser({
      id: targetUserId,
      email: Email.create('target@tavla.internal'),
      passwordHash: PasswordHash.create('argon2id$fake$hash'),
      firstName: 'Target',
      lastName: 'User',
      phone: null,
      language: 'en',
      at: now,
    }).verifyEmail(now);
    const withStatus = status === UserStatus.Active ? pending : pending.disableLogin(now);
    await userRepository.save(withStatus);
  }

  function build() {
    const userRepository = new InMemoryUserRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new PlatformAdminEnableLoginUseCase(
      userRepository,
      eventPublisher,
      new FixedClock(now),
      new SequentialIdGenerator(['eeeeeeee-1111-4111-8111-111111111111']),
    );
    return { useCase, userRepository, eventPublisher };
  }

  it('re-activates a Suspended (admin-disabled) account', async () => {
    const { useCase, userRepository } = build();
    await seedTargetUser(userRepository, UserStatus.Suspended);

    await useCase.execute({ targetUserId, actorId: adminActorId });

    const updated = await userRepository.findById(UserId.create(targetUserId));
    expect(updated?.status).toBe(UserStatus.Active);
  });

  it('publishes AccountLoginEnabledEvent', async () => {
    const { useCase, userRepository, eventPublisher } = build();
    await seedTargetUser(userRepository, UserStatus.Suspended);

    await useCase.execute({ targetUserId, actorId: adminActorId });

    const event = eventPublisher.events[0] as AccountLoginEnabledEvent;
    expect(event).toBeInstanceOf(AccountLoginEnabledEvent);
    expect(event.payload).toEqual({ targetUserId, actorId: adminActorId });
  });

  it('rejects enabling an account that is not currently Suspended (e.g. already Active) - not treated as an idempotent no-op', async () => {
    const { useCase, userRepository } = build();
    await seedTargetUser(userRepository, UserStatus.Active);

    await expect(useCase.execute({ targetUserId, actorId: adminActorId })).rejects.toThrow(
      AccountNotDisabledException,
    );
  });

  it('rejects an unknown target account (IDOR-safe)', async () => {
    const { useCase } = build();

    await expect(useCase.execute({ targetUserId, actorId: adminActorId })).rejects.toThrow(
      UserNotFoundException,
    );
  });
});
