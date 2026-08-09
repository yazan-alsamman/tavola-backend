import { RequestAccountDeletionUseCase } from './request-account-deletion.use-case';
import { RegistrationPolicy } from '@modules/authentication/domain/services/registration-policy';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { SessionRevokeReason } from '@modules/authentication/domain/enums/authentication.enums';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { InvalidAccessTokenException } from '@modules/authentication/application/exceptions/access-token.exceptions';
import { InvalidCredentialsException } from '@modules/authentication/application/exceptions/login.exceptions';
import { UserAccountDeletionRequestedEvent } from '@modules/authentication/domain/events/authentication.events';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { DeviceSession } from '@modules/authentication/domain/entities/device-session.entity';
import { DeviceType } from '@modules/authentication/domain/enums/authentication.enums';
import { Reservation } from '@modules/reservations/domain/entities/reservation.entity';
import { ReservationSource } from '@modules/reservations/domain/enums/reservation.enums';
import { ReservationWaitlistEntry } from '@modules/waitlist/domain/entities/reservation-waitlist-entry.entity';
import { CancelWaitlistEntryUseCase } from '@modules/waitlist/application/use-cases/cancel-waitlist-entry.use-case';
import { InMemoryReservationRepository } from '../../../../../test/reservations/support/in-memory-reservation.repository';
import { InMemoryReservationWaitlistEntryRepository } from '../../../../../test/waitlist/support/in-memory-reservation-waitlist-entry.repository';
import {
  CollectingEventPublisher,
  FakePasswordHasher,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryDeviceSessionRepository,
  InMemorySystemConfiguration,
  InMemoryTokenFamilyRepository,
  InMemoryUserRepository,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { AccountDeletionSchedulerPort } from '../ports/account-deletion-scheduler.port';
import { OpenReservationsBlockDeletionException } from '../exceptions/open-reservations-block-deletion.exception';

class FakeAccountDeletionScheduler implements AccountDeletionSchedulerPort {
  readonly scheduled: Array<{ userId: string; anonymizeAt: Date }> = [];
  async scheduleAnonymization(userId: string, anonymizeAt: Date): Promise<void> {
    this.scheduled.push({ userId, anonymizeAt });
  }
  async cancelAnonymization(): Promise<void> {
    throw new Error('Not needed by this suite.');
  }
}

describe('RequestAccountDeletionUseCase', () => {
  const now = new Date('2026-08-07T12:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const restaurantId = '22222222-2222-4222-8222-222222222222';
  const branchId = '33333333-3333-4333-8333-333333333333';
  const tableId = '44444444-4444-4444-8444-444444444444';
  const CORRECT_PASSWORD = 'CurrentPass123!';

  function customerActor() {
    return {
      actorType: AccessTokenActorType.User as const,
      userId,
      sessionId: '55555555-5555-4555-8555-555555555555',
      sessionVersion: 1,
      tokenFamilyId: '66666666-6666-4666-8666-666666666666',
    };
  }

  function build(ids: string[] = ['eeeeeeee-1111-4111-8111-111111111111']) {
    const userRepository = new InMemoryUserRepository();
    const deviceSessionRepository = new InMemoryDeviceSessionRepository();
    const tokenFamilyRepository = new InMemoryTokenFamilyRepository();
    const reservationRepository = new InMemoryReservationRepository();
    const waitlistRepository = new InMemoryReservationWaitlistEntryRepository();
    const cancelWaitlistEntryExecute = jest.fn().mockResolvedValue(undefined);
    const cancelWaitlistEntryUseCase = {
      execute: cancelWaitlistEntryExecute,
    } as unknown as CancelWaitlistEntryUseCase;
    const scheduler = new FakeAccountDeletionScheduler();
    const eventPublisher = new CollectingEventPublisher();
    const systemConfiguration = new InMemorySystemConfiguration({
      anonymizationGracePeriodDays: 30,
    });

    const useCase = new RequestAccountDeletionUseCase(
      userRepository,
      new FakePasswordHasher(),
      deviceSessionRepository,
      tokenFamilyRepository,
      reservationRepository,
      waitlistRepository,
      cancelWaitlistEntryUseCase,
      scheduler,
      new ImmediateUnitOfWork(),
      eventPublisher,
      new FixedClock(now),
      new SequentialIdGenerator(ids),
      systemConfiguration,
    );

    return {
      useCase,
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      reservationRepository,
      waitlistRepository,
      cancelWaitlistEntryExecute,
      scheduler,
      eventPublisher,
    };
  }

  async function seedUser(userRepository: InMemoryUserRepository) {
    const user = RegistrationPolicy.createPendingUser({
      id: userId,
      email: Email.create('customer@example.com'),
      passwordHash: PasswordHash.create(`argon2id$fake$${CORRECT_PASSWORD}`),
      firstName: 'Jane',
      lastName: 'Doe',
      phone: null,
      language: 'en',
      at: now,
    }).verifyEmail(now);
    await userRepository.save(user);
  }

  function seedActiveSession(deviceSessionRepository: InMemoryDeviceSessionRepository) {
    deviceSessionRepository.sessions.push(
      DeviceSession.create({
        id: '77777777-7777-4777-8777-777777777777',
        userId,
        tokenFamilyId: '66666666-6666-4666-8666-666666666666',
        refreshTokenHash: 'a'.repeat(64),
        previousRefreshTokenHash: null,
        deviceName: null,
        deviceType: DeviceType.Unknown,
        ipAddress: null,
        userAgent: null,
        sessionVersion: 1,
        permissionsVersion: 1,
        lastUsedAt: now,
        revokedAt: null,
        revokedReason: null,
        expiresAt: new Date(now.getTime() + 86_400_000),
        createdAt: now,
      }),
    );
  }

  it('verifies the password, revokes every session/token, schedules anonymization per the configured grace period, and publishes UserAccountDeletionRequestedEvent', async () => {
    const {
      useCase,
      userRepository,
      deviceSessionRepository,
      tokenFamilyRepository,
      scheduler,
      eventPublisher,
    } = build();
    await seedUser(userRepository);
    seedActiveSession(deviceSessionRepository);

    const result = await useCase.execute({
      actor: customerActor(),
      password: CORRECT_PASSWORD,
      correlationId: 'corr-del-1',
    });

    expect(result.scheduledAnonymizationAt).toEqual(new Date('2026-09-06T12:00:00.000Z'));

    const updated = await userRepository.findById(UserId.create(userId));
    expect(updated?.hasPendingDeletionRequest()).toBe(true);
    expect(updated?.status).toBe('Active');
    // sessionVersion bumped so SessionVersionGuard rejects the caller's own
    // already-issued access token on the very next request - not just
    // future refreshes (see the use case's own doc comment on this).
    expect(updated?.toProps().sessionVersion).toBe(2);

    expect(deviceSessionRepository.sessions[0].isRevoked()).toBe(true);
    expect(deviceSessionRepository.sessions[0].toProps().revokedReason).toBe(
      SessionRevokeReason.AccountDeletion,
    );
    expect(tokenFamilyRepository.families).toEqual([]);

    expect(scheduler.scheduled).toEqual([
      { userId, anonymizeAt: new Date('2026-09-06T12:00:00.000Z') },
    ]);

    const event = eventPublisher.events[0] as UserAccountDeletionRequestedEvent;
    expect(event).toBeInstanceOf(UserAccountDeletionRequestedEvent);
    expect(event.payload).toEqual({
      userId,
      scheduledAnonymizationAt: '2026-09-06T12:00:00.000Z',
    });
  });

  it('rejects an incorrect password with InvalidCredentialsException and performs no side effects', async () => {
    const { useCase, userRepository, scheduler, eventPublisher } = build();
    await seedUser(userRepository);

    await expect(
      useCase.execute({ actor: customerActor(), password: 'WrongPassword1!' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);

    expect(scheduler.scheduled).toEqual([]);
    expect(eventPublisher.events).toHaveLength(0);
  });

  it('rejects a non-Customer actor (Employee)', async () => {
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
        password: CORRECT_PASSWORD,
      }),
    ).rejects.toBeInstanceOf(PermissionDeniedException);
  });

  it('rejects an unknown user (IDOR-safe)', async () => {
    const { useCase } = build();

    await expect(
      useCase.execute({ actor: customerActor(), password: CORRECT_PASSWORD }),
    ).rejects.toBeInstanceOf(InvalidAccessTokenException);
  });

  it('blocks (409) when an open Pending/Approved reservation exists, and performs no side effects', async () => {
    const { useCase, userRepository, reservationRepository, scheduler, eventPublisher } = build();
    await seedUser(userRepository);
    reservationRepository.seed(
      Reservation.create({
        id: '88888888-8888-4888-8888-888888888888',
        userId,
        reservationGuestId: null,
        source: ReservationSource.Online,
        restaurantId,
        branchId,
        tableId,
        reservationDate: new Date('2026-08-10T00:00:00.000Z'),
        reservationStartTime: new Date('2026-08-10T18:00:00.000Z'),
        reservationEndTime: new Date('2026-08-10T19:30:00.000Z'),
        guests: 2,
        tableCapacity: 4,
        notes: null,
        createdBy: userId,
        now,
      }),
    );

    await expect(
      useCase.execute({ actor: customerActor(), password: CORRECT_PASSWORD }),
    ).rejects.toBeInstanceOf(OpenReservationsBlockDeletionException);

    expect(scheduler.scheduled).toEqual([]);
    expect(eventPublisher.events).toHaveLength(0);
  });

  it('auto-cancels every active waitlist entry via the existing CancelWaitlistEntryUseCase, reused verbatim', async () => {
    const { useCase, userRepository, waitlistRepository, cancelWaitlistEntryExecute } = build();
    await seedUser(userRepository);
    waitlistRepository.seed(
      ReservationWaitlistEntry.create({
        id: '99999999-9999-4999-8999-999999999999',
        restaurantId,
        branchId,
        userId,
        reservationGuestId: null,
        partySize: 2,
        preferredDate: new Date('2026-08-10T00:00:00.000Z'),
        preferredTimeFrom: new Date('2026-08-10T18:00:00.000Z'),
        preferredTimeTo: null,
        position: 1,
        expiresAt: new Date('2026-08-10T20:00:00.000Z'),
        notes: null,
        createdBy: userId,
        now,
      }),
    );

    await useCase.execute({ actor: customerActor(), password: CORRECT_PASSWORD });

    expect(cancelWaitlistEntryExecute).toHaveBeenCalledTimes(1);
    expect(cancelWaitlistEntryExecute).toHaveBeenCalledWith(
      expect.objectContaining({ entryId: '99999999-9999-4999-8999-999999999999' }),
    );
  });

  it('is idempotent - a repeat request while already pending re-verifies the password but does not reschedule or republish', async () => {
    const { useCase, userRepository, scheduler, eventPublisher } = build();
    await seedUser(userRepository);

    const first = await useCase.execute({ actor: customerActor(), password: CORRECT_PASSWORD });
    expect(scheduler.scheduled).toHaveLength(1);
    expect(eventPublisher.events).toHaveLength(1);

    const second = await useCase.execute({ actor: customerActor(), password: CORRECT_PASSWORD });

    expect(second.scheduledAnonymizationAt).toEqual(first.scheduledAnonymizationAt);
    expect(scheduler.scheduled).toHaveLength(1);
    expect(eventPublisher.events).toHaveLength(1);
  });

  it('a repeat request with the wrong password while already pending still fails - schedule state is never probeable without credentials', async () => {
    const { useCase, userRepository } = build();
    await seedUser(userRepository);
    await useCase.execute({ actor: customerActor(), password: CORRECT_PASSWORD });

    await expect(
      useCase.execute({ actor: customerActor(), password: 'WrongPassword1!' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
  });
});
