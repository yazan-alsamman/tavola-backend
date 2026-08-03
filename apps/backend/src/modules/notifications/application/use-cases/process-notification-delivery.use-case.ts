import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import { NotificationId } from '@shared/domain/value-objects/identifiers.vo';
import { USER_REPOSITORY } from '@modules/authentication/domain/tokens/authentication.tokens';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { ReservationReminderSentEvent } from '@modules/reservations/domain/events/reservation.events';
import { WaitlistEntryNotifiedEvent } from '@modules/waitlist/domain/events/waitlist.events';
import { WaitlistStatus } from '@modules/waitlist/domain/enums/waitlist.enums';
import {
  RESERVATION_WAITLIST_ENTRY_REPOSITORY,
  ReservationWaitlistEntryRepository,
} from '@modules/waitlist/domain/repositories/reservation-waitlist-entry.repository';
import { NotificationChannel, NotificationPushStatus } from '../../domain/enums/notification.enums';
import {
  NOTIFICATION_REPOSITORY,
  NotificationRepository,
} from '../../domain/repositories/notification.repository';
import {
  NOTIFICATION_TEMPLATE_REPOSITORY,
  NotificationTemplateRepository,
} from '../../domain/repositories/notification-template.repository';
import {
  NOTIFICATION_PROVIDER,
  NotificationProviderPort,
} from '../ports/notification-provider.port';

export interface ProcessNotificationDeliveryInput {
  readonly notificationId: string;
  /** `true` on the BullMQ job's final configured attempt - a `retryableFailure` here is written `Failed`, not rethrown. */
  readonly isFinalAttempt: boolean;
  readonly correlationId?: string;
}

/**
 * Phase 9 (architecture frozen 2026-07-25) - `NotificationQueue`'s sole
 * consumer, delegated to entirely by `NotificationDeliveryProcessor`
 * (mirrors `ExpireWaitlistEntryProcessor` -> `ExpireWaitlistEntryUseCase`'s
 * established one-processor-one-use-case precedent). Resolves the Push
 * channel's own `NotificationTemplate` at send time (independent of the
 * already-persisted In-App `title`/`body` - LOCALIZATION.md: "Push and
 * InApp may carry separate resolved content"), calls
 * `NotificationProviderPort`, records the terminal outcome on the
 * `Notification` row (decision item 5 - at most one terminal write ever),
 * and - only on `Accepted` - fires the two frozen side effects: publishing
 * `ReservationReminderSentEvent` (decision item 6) and activating
 * `WaitlistEntryNotified` (decision item 7).
 */
@Injectable()
export class ProcessNotificationDeliveryUseCase {
  private readonly logger = new Logger(ProcessNotificationDeliveryUseCase.name);

  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notificationRepository: NotificationRepository,
    @Inject(NOTIFICATION_TEMPLATE_REPOSITORY)
    private readonly templateRepository: NotificationTemplateRepository,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(NOTIFICATION_PROVIDER) private readonly provider: NotificationProviderPort,
    @Inject(RESERVATION_WAITLIST_ENTRY_REPOSITORY)
    private readonly waitlistEntryRepository: ReservationWaitlistEntryRepository,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(input: ProcessNotificationDeliveryInput): Promise<void> {
    const notification = await this.notificationRepository.findById(
      NotificationId.create(input.notificationId),
    );
    if (notification === null) {
      this.logger.warn(
        `ProcessNotificationDeliveryUseCase: notification ${input.notificationId} not found - stale job, skipping.`,
      );
      return;
    }

    // Both terminal push values are written at most once (decision item 5) -
    // a duplicate/stale job re-delivery for an already-Accepted/Failed
    // notification is a safe no-op, never a re-send.
    if (notification.pushStatus !== NotificationPushStatus.Queued) {
      return;
    }

    const user = await this.userRepository.findById(notification.userId);
    if (user === null) {
      await this.notificationRepository.save(
        notification.recordPushFailed('no_subscription', this.clock.now()),
      );
      return;
    }

    const pushTemplate = await this.resolvePushTemplate(notification.type, user.language);
    const idempotencyKey = notification.pushIdempotencyKey;
    if (idempotencyKey === null) {
      // Unreachable in practice (`enqueuePush` always sets it before this
      // job is ever created) - defensive guard, not a silent send without one.
      await this.notificationRepository.save(
        notification.recordPushFailed('provider_error', this.clock.now()),
      );
      return;
    }

    const result = await this.provider.send({
      userId: notification.userId.value,
      title: pushTemplate?.title ?? notification.title,
      body: pushTemplate?.body ?? notification.body,
      data: notification.data,
      idempotencyKey,
    });

    if (result.outcome === 'accepted') {
      const at = this.clock.now();
      await this.notificationRepository.save(
        notification.recordPushAccepted(result.providerMessageId, at),
      );
      await this.fireAcceptedSideEffects(notification.type, notification.data, at);
      return;
    }

    if (result.outcome === 'noRecipients') {
      await this.notificationRepository.save(
        notification.recordPushFailed('no_subscription', this.clock.now()),
      );
      return;
    }

    if (result.outcome === 'permanentFailure') {
      await this.notificationRepository.save(
        notification.recordPushFailed('provider_error', this.clock.now()),
      );
      return;
    }

    // retryableFailure: let BullMQ's own retry/backoff handle it unless this
    // was already the last configured attempt (decision item 9 - retry
    // count/backoff itself is an implementation detail, not frozen).
    if (!input.isFinalAttempt) {
      throw new Error(`Notification push retryable failure: ${result.reason}`);
    }
    await this.notificationRepository.save(
      notification.recordPushFailed('rate_limited', this.clock.now()),
    );
  }

  /**
   * Fires only on `Accepted` - never on `Failed` (decision items 6/7: "do
   * NOT falsely emit `ReservationReminderSent`" / "never merely because a
   * delivery job was queued... never on push failure").
   */
  private async fireAcceptedSideEffects(
    eventType: string,
    data: Record<string, unknown> | null,
    at: Date,
  ): Promise<void> {
    if (eventType === 'ReservationReminderDue' && data !== null) {
      await this.eventPublisher.publish(
        new ReservationReminderSentEvent(
          this.idGenerator.generate(),
          {
            reservationId: data.reservationId as string,
            restaurantId: data.restaurantId as string,
            branchId: data.branchId as string,
            reservationStartTime: data.reservationStartTime as string,
          },
          at,
        ),
      );
      return;
    }

    if (eventType === 'WaitlistEntryPromoted' && data !== null) {
      const entryId = data.entryId as string;
      const entry = await this.waitlistEntryRepository.findById(entryId);
      if (entry === null || entry.status !== WaitlistStatus.Waiting) {
        // Already Converted/Cancelled/Expired by the time the push
        // resolved - a disclosed, accepted v1 race outcome (decision item 7).
        return;
      }
      const notified = entry.notify(at);
      const applied = await this.waitlistEntryRepository.updateTransitioningFrom(
        notified,
        WaitlistStatus.Waiting,
      );
      if (applied) {
        await this.eventPublisher.publish(
          new WaitlistEntryNotifiedEvent(
            this.idGenerator.generate(),
            {
              entryId,
              restaurantId: data.restaurantId as string,
              branchId: data.branchId as string,
              notifiedAt: at.toISOString(),
            },
            at,
          ),
        );
      }
    }
  }

  private async resolvePushTemplate(eventType: string, language: string) {
    const exact = await this.templateRepository.findExact(
      eventType,
      language,
      NotificationChannel.Push,
    );
    if (exact !== null) {
      return exact;
    }
    return this.templateRepository.findDefault(eventType, NotificationChannel.Push);
  }
}
