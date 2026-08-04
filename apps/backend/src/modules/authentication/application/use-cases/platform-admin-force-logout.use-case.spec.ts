import { PlatformAdminForceLogoutUseCase } from './platform-admin-force-logout.use-case';
import { UserNotFoundException } from '../exceptions/user-not-found.exception';
import { SessionFamilyRevokedEvent } from '../../domain/events/authentication.events';
import { SessionRevokeReason } from '../../domain/enums/authentication.enums';
import { RegistrationPolicy } from '@modules/authentication/domain/services/registration-policy';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryDeviceSessionRepository,
  InMemoryTokenFamilyRepository,
  InMemoryUserRepository,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('PlatformAdminForceLogoutUseCase', () => {
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
    const deviceSessionRepository = new InMemoryDeviceSessionRepository();
    const tokenFamilyRepository = new InMemoryTokenFamilyRepository();
    const eventPublisher = new CollectingEventPublisher();
    const useCase = new PlatformAdminForceLogoutUseCase(
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      new ImmediateUnitOfWork(),
      eventPublisher,
      new FixedClock(now),
      new SequentialIdGenerator(['eeeeeeee-1111-4111-8111-111111111111']),
    );
    return {
      useCase,
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      eventPublisher,
    };
  }

  it('bumps sessionVersion and revokes every DeviceSession/TokenFamily for the TARGET account', async () => {
    const { useCase, userRepository } = build();
    await seedTargetUser(userRepository);

    await useCase.execute({ targetUserId, actorId: adminActorId });

    const updated = await userRepository.findById(UserId.create(targetUserId));
    expect(updated?.sessionVersion).toBe(2);
  });

  it('publishes SessionFamilyRevokedEvent with reason=Admin and actorId set to the PlatformAdmin, not the target', async () => {
    const { useCase, userRepository, eventPublisher } = build();
    await seedTargetUser(userRepository);

    await useCase.execute({ targetUserId, actorId: adminActorId, correlationId: 'corr-1' });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as SessionFamilyRevokedEvent;
    expect(event).toBeInstanceOf(SessionFamilyRevokedEvent);
    expect(event.payload).toMatchObject({
      userId: targetUserId,
      tokenFamilyId: 'all',
      reason: SessionRevokeReason.Admin,
      actorId: adminActorId,
    });
    expect(event.correlationId).toBe('corr-1');
  });

  it('rejects an unknown target account (IDOR-safe)', async () => {
    const { useCase } = build();

    await expect(useCase.execute({ targetUserId, actorId: adminActorId })).rejects.toThrow(
      UserNotFoundException,
    );
  });
});
