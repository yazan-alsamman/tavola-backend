import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { UserId, FileId } from '@shared/domain/value-objects/identifiers.vo';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { USER_REPOSITORY } from '@modules/authentication/domain/tokens/authentication.tokens';
import { AccountAnonymizationService } from '@modules/authentication/domain/services/account-anonymization.service';
import { UserAccountAnonymizedEvent } from '@modules/authentication/domain/events/authentication.events';
import {
  FileRepository,
  FILE_REPOSITORY,
} from '@modules/files/domain/repositories/file.repository';
import { StoragePort, STORAGE_PORT } from '@modules/files/application/ports/storage.port';
import {
  MessageRepository,
  MESSAGE_REPOSITORY,
} from '@modules/messaging/domain/repositories/message.repository';
import {
  FavoriteRestaurantRepository,
  FAVORITE_RESTAURANT_REPOSITORY,
} from '../../domain/repositories/favorite-restaurant.repository';
import { AnonymizeUserAccountCommand } from '../dto/anonymize-user-account.command';

/**
 * Phase 20.X (ADR-014 execution) - the BullMQ-scheduled job body
 * (`AnonymizeUserAccountProcessor`) that fires once
 * `SystemConfiguration.anonymizationGracePeriodDays` elapses without
 * cancellation. Irreversible. Never invoked from any other flow (matches
 * `AccountAnonymizationService`'s own doc comment).
 *
 * Retained-vs-touched per ADR-014 and this phase's own retention analysis
 * (see the Engineering Report): `User` PII scrubbed in place; `Favorite`
 * rows hard-deleted; `Message` rows this user authored anonymized in place
 * (existing `Message.anonymize()` write shape, applied in bulk); avatar
 * `FileRecord`/MinIO object cleared via the exact
 * `UploadCurrentUserAvatarUseCase.cleanupOldAvatar` pattern. Reservation,
 * ReservationHistory, Review, RestaurantReply, AuditLog, UserConsent,
 * Notification, PasswordHistory/PasswordResetToken rows are deliberately
 * never touched here.
 */
@Injectable()
export class AnonymizeUserAccountUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(FAVORITE_RESTAURANT_REPOSITORY)
    private readonly favoriteRepository: FavoriteRestaurantRepository,
    @Inject(MESSAGE_REPOSITORY) private readonly messageRepository: MessageRepository,
    @Inject(FILE_REPOSITORY) private readonly fileRepository: FileRepository,
    @Inject(STORAGE_PORT) private readonly storagePort: StoragePort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(command: AnonymizeUserAccountCommand): Promise<void> {
    const now = this.clock.now();
    const userId = UserId.create(command.userId);

    const user = await this.userRepository.findById(userId);
    // The User row is never hard-deleted (ADR-014) - null here would mean
    // this job outlived the row entirely, which should never happen. Not
    // an error worth failing/retrying the job over either way.
    if (user === null) {
      return;
    }
    // Retried/duplicate job delivery (BullMQ `removeOnFail` retry, or a
    // manual re-run) - idempotent no-op, no second event/audit row.
    if (user.isAnonymized()) {
      return;
    }

    const placeholderId = this.idGenerator.generate();
    const anonymized = AccountAnonymizationService.anonymize(user, placeholderId, now);
    const avatarId = await this.userRepository.getAvatarId(userId);

    await this.unitOfWork.execute(async () => {
      await this.userRepository.save(anonymized);
      await this.favoriteRepository.deleteAllByUserId(userId);
      await this.messageRepository.anonymizeAllBySenderUserId(userId, now);
    });

    if (avatarId !== null) {
      await this.clearAvatar(avatarId, userId, now);
    }

    await this.eventPublisher.publish(
      new UserAccountAnonymizedEvent(
        this.idGenerator.generate(),
        { userId: userId.value },
        now,
        command.correlationId,
      ),
    );
  }

  private async clearAvatar(avatarId: string, userId: UserId, at: Date): Promise<void> {
    // The pointer is cleared unconditionally first - the privacy-relevant
    // fact (nothing resolves to the real photo anymore) holds even if the
    // storage-layer cleanup below fails.
    await this.userRepository.updateAvatarId(userId, null, at);
    try {
      const file = await this.fileRepository.findById(FileId.create(avatarId));
      if (file === null) {
        return;
      }
      await this.storagePort.delete(file.bucket, file.objectKey);
      await this.fileRepository.softDelete(FileId.create(avatarId), at);
    } catch {
      // Best-effort, matching UploadCurrentUserAvatarUseCase.cleanupOldAvatar's
      // own precedent - a storage-layer failure here leaves only a harmless
      // orphaned MinIO object with no DB reference (never served, flagged
      // for ops cleanup), never blocks anonymization itself.
    }
  }
}
