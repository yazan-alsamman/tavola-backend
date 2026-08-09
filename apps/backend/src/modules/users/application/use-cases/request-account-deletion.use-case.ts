import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import {
  SYSTEM_CONFIG_KEYS,
  SystemConfigurationPort,
} from '@shared/application/ports/system-configuration.port';
import { Password } from '@shared/domain/value-objects/password.vo';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import {
  DeviceSessionRepository,
  TokenFamilyRepository,
  UserRepository,
} from '@modules/authentication/domain/repositories/authentication.repositories';
import {
  DEVICE_SESSION_REPOSITORY,
  TOKEN_FAMILY_REPOSITORY,
  USER_REPOSITORY,
  PASSWORD_HASHER,
  SYSTEM_CONFIGURATION,
} from '@modules/authentication/domain/tokens/authentication.tokens';
import { PasswordHasher } from '@modules/authentication/domain/services/password-hasher.port';
import { SessionRevokeReason } from '@modules/authentication/domain/enums/authentication.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { InvalidAccessTokenException } from '@modules/authentication/application/exceptions/access-token.exceptions';
import { InvalidCredentialsException } from '@modules/authentication/application/exceptions/login.exceptions';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { UserAccountDeletionRequestedEvent } from '@modules/authentication/domain/events/authentication.events';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '@modules/reservations/domain/repositories/reservation.repository';
import {
  ReservationWaitlistEntryRepository,
  RESERVATION_WAITLIST_ENTRY_REPOSITORY,
} from '@modules/waitlist/domain/repositories/reservation-waitlist-entry.repository';
import { CancelWaitlistEntryUseCase } from '@modules/waitlist/application/use-cases/cancel-waitlist-entry.use-case';
import {
  AccountDeletionSchedulerPort,
  ACCOUNT_DELETION_SCHEDULER,
} from '../ports/account-deletion-scheduler.port';
import { OpenReservationsBlockDeletionException } from '../exceptions/open-reservations-block-deletion.exception';
import { RequestAccountDeletionCommand } from '../dto/request-account-deletion.command';
import { RequestAccountDeletionResult } from '../dto/request-account-deletion.result';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Phase 20.X (ADR-014 execution) - `DELETE /users/me`. Verifies the caller's
 * current password, blocks (409) on any open Reservation, immediately
 * revokes every DeviceSession/TokenFamily (mirrors `PlatformAdminForceLogoutUseCase`/
 * `ResetPasswordUseCase`'s exact `revokeAllByUserId` pair), auto-cancels
 * every active waitlist entry (reused verbatim via `CancelWaitlistEntryUseCase`,
 * not re-derived), then schedules `AnonymizeUserAccountUseCase` to run once
 * `SystemConfiguration.anonymizationGracePeriodDays` elapses.
 *
 * `User.status` is deliberately left `Active` - see `User.requestDeletion()`'s
 * own doc comment for why the account must remain loggable-in through the
 * grace period (reaching Cancel requires a fresh login, since sessions were
 * just revoked above).
 *
 * Idempotent: a repeat call while a request is already pending still
 * re-verifies the password (so a stale/malicious caller can't probe
 * schedule state without credentials) but performs no further side effects
 * - no reschedule, no duplicate event/audit row - mirroring the Phase 19.1
 * M1 idempotent-mutation pattern.
 */
@Injectable()
export class RequestAccountDeletionUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: PasswordHasher,
    @Inject(DEVICE_SESSION_REPOSITORY)
    private readonly deviceSessionRepository: DeviceSessionRepository,
    @Inject(TOKEN_FAMILY_REPOSITORY)
    private readonly tokenFamilyRepository: TokenFamilyRepository,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservationRepository: ReservationRepository,
    @Inject(RESERVATION_WAITLIST_ENTRY_REPOSITORY)
    private readonly waitlistRepository: ReservationWaitlistEntryRepository,
    private readonly cancelWaitlistEntryUseCase: CancelWaitlistEntryUseCase,
    @Inject(ACCOUNT_DELETION_SCHEDULER)
    private readonly accountDeletionScheduler: AccountDeletionSchedulerPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
  ) {}

  async execute(command: RequestAccountDeletionCommand): Promise<RequestAccountDeletionResult> {
    // Customer-only (this session's own requirement, not a pre-existing
    // rule): PlatformAdmin can never reach this route at all (separate JWT
    // pipeline, ADR-022), but Employee/OrganizationMember actors otherwise
    // could, since they are also User rows underneath - explicitly
    // rejected here, mirroring `SubmitReviewUseCase`'s exact
    // actor-type-gate placement (in the use case, not the controller).
    if (command.actor.actorType !== AccessTokenActorType.User) {
      throw new PermissionDeniedException();
    }

    const now = this.clock.now();
    const userId = UserId.create(command.actor.userId);

    const user = await this.userRepository.findById(userId);
    if (user === null) {
      throw new InvalidAccessTokenException();
    }

    user.canLogin(now);

    const password = Password.create(command.password);
    const passwordMatches = await this.passwordHasher.verify(password, user.passwordHash);
    if (!passwordMatches) {
      throw new InvalidCredentialsException();
    }

    if (user.hasPendingDeletionRequest()) {
      return { scheduledAnonymizationAt: user.scheduledAnonymizationAt as Date };
    }

    const hasOpenReservations = await this.reservationRepository.hasOpenReservationsByUserId(
      userId,
      now,
    );
    if (hasOpenReservations) {
      throw new OpenReservationsBlockDeletionException();
    }

    const gracePeriodDays = await this.systemConfiguration.getNumber(
      SYSTEM_CONFIG_KEYS.anonymizationGracePeriodDays,
      30,
    );
    const scheduledAnonymizationAt = new Date(
      now.getTime() + gracePeriodDays * MILLISECONDS_PER_DAY,
    );
    const requested = user.requestDeletion(scheduledAnonymizationAt, now);

    await this.unitOfWork.execute(async () => {
      await this.userRepository.save(requested);
      // Revoking DeviceSession/TokenFamily rows alone only blocks future
      // refreshes - an already-issued access token stays valid by
      // signature until it naturally expires. Bumping sessionVersion
      // (the same atomic accessor PlatformAdminForceLogoutUseCase/
      // LogoutAllDevicesUseCase use, never the unused entity-level
      // bumpSessionVersion() method) is what makes SessionVersionGuard
      // reject it on the very next request - required for "every active
      // login" to mean immediately, not just eventually.
      await this.userRepository.incrementSessionVersion(userId, now);
      await this.deviceSessionRepository.revokeAllByUserId(
        userId,
        now,
        SessionRevokeReason.AccountDeletion,
      );
      await this.tokenFamilyRepository.revokeAllByUserId(userId, now);
    });

    // Auto-cancel every active waitlist entry - each its own already-
    // transactional call via the existing use case (not bundled into the
    // transaction above: a partial failure here is retryable/best-effort,
    // not a correctness requirement of the deletion request itself).
    const activeWaitlistEntries = await this.waitlistRepository.findActiveByUserId(userId);
    for (const entry of activeWaitlistEntries) {
      await this.cancelWaitlistEntryUseCase.execute({
        actor: command.actor,
        entryId: entry.entryId,
        correlationId: command.correlationId,
      });
    }

    await this.accountDeletionScheduler.scheduleAnonymization(
      userId.value,
      scheduledAnonymizationAt,
      command.correlationId,
    );

    await this.eventPublisher.publish(
      new UserAccountDeletionRequestedEvent(
        this.idGenerator.generate(),
        { userId: userId.value, scheduledAnonymizationAt: scheduledAnonymizationAt.toISOString() },
        now,
        command.correlationId,
      ),
    );

    return { scheduledAnonymizationAt };
  }
}
