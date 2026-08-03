import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainEvent } from '@shared/domain/base/domain-event.base';
import { ReservationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import { USER_REPOSITORY } from '@modules/authentication/domain/tokens/authentication.tokens';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import {
  ReservationApprovedEvent,
  ReservationCancelledEvent,
  ReservationNoShowEvent,
  ReservationRescheduledEvent,
  ReservationReminderDueEvent,
  TableReadyNotifiedEvent,
} from '@modules/reservations/domain/events/reservation.events';
import {
  RESERVATION_REPOSITORY,
  ReservationRepository,
} from '@modules/reservations/domain/repositories/reservation.repository';
import { WaitlistEntryPromotedEvent } from '@modules/waitlist/domain/events/waitlist.events';
import {
  RESERVATION_WAITLIST_ENTRY_REPOSITORY,
  ReservationWaitlistEntryRepository,
} from '@modules/waitlist/domain/repositories/reservation-waitlist-entry.repository';
import { MessageSentEvent } from '@modules/messaging/domain/events/messaging.events';
import { MessageSenderType } from '@modules/messaging/domain/enums/messaging.enums';
import {
  CONVERSATION_PARTICIPANT_REPOSITORY,
  ConversationParticipantRepository,
} from '@modules/messaging/domain/repositories/conversation-participant.repository';
import { ConversationId } from '@shared/domain/value-objects/identifiers.vo';
import { Notification } from '../../domain/entities/notification.entity';
import { NotificationChannel } from '../../domain/enums/notification.enums';
import { NotificationCreatedEvent } from '../../domain/events/notification.events';
import {
  NOTIFICATION_REPOSITORY,
  NotificationRepository,
} from '../../domain/repositories/notification.repository';
import {
  NOTIFICATION_TEMPLATE_REPOSITORY,
  NotificationTemplateRepository,
} from '../../domain/repositories/notification-template.repository';
import { NotificationTemplate } from '../../domain/entities/notification-template.entity';
import {
  NOTIFICATION_DELIVERY_SCHEDULER,
  NotificationDeliverySchedulerPort,
} from '../ports/notification-delivery-scheduler.port';

/**
 * Internal shape produced by `resolveNotificationIntent` for each of the
 * seven Phase 9 v1 allow-listed source events (EVENTS.md's frozen
 * event -> notification matrix). `null` means "not on the allow-list" - the
 * event is silently ignored, never automatically mapped (decision item 17:
 * "No event outside this list produces a Phase 9 notification in v1").
 */
interface NotificationIntent {
  readonly eventType: string;
  readonly pushEligible: boolean;
  readonly reservationId: string | null;
  readonly entryId: string | null;
  readonly conversationId: string | null;
  readonly restaurantId: string;
  readonly branchId: string | null;
  readonly reservationStartTime: string | null;
}

/**
 * Deliberately an `instanceof` dispatch chain, mirroring
 * `AuditingEventPublisher.toAuditEntry`/`mapDomainEventForRealtime`'s
 * established convention in this codebase - not a name-keyed lookup table.
 * Exported for direct unit testing of the allow-list without standing up the
 * full `NotificationDispatcher`.
 */
export function resolveNotificationIntent(event: DomainEvent): NotificationIntent | null {
  if (
    event instanceof ReservationApprovedEvent ||
    event instanceof ReservationCancelledEvent ||
    event instanceof ReservationRescheduledEvent
  ) {
    const p = event.payload;
    return {
      eventType: event.eventName,
      pushEligible: true,
      reservationId: p.reservationId,
      entryId: null,
      conversationId: null,
      restaurantId: p.restaurantId,
      branchId: p.branchId,
      reservationStartTime: null,
    };
  }

  if (event instanceof ReservationReminderDueEvent) {
    const p = event.payload;
    return {
      eventType: event.eventName,
      pushEligible: true,
      reservationId: p.reservationId,
      entryId: null,
      conversationId: null,
      restaurantId: p.restaurantId,
      branchId: p.branchId,
      reservationStartTime: p.reservationStartTime,
    };
  }

  if (event instanceof TableReadyNotifiedEvent) {
    const p = event.payload;
    return {
      eventType: event.eventName,
      pushEligible: true,
      reservationId: p.reservationId,
      entryId: null,
      conversationId: null,
      restaurantId: p.restaurantId,
      branchId: p.branchId,
      reservationStartTime: null,
    };
  }

  if (event instanceof WaitlistEntryPromotedEvent) {
    const p = event.payload;
    return {
      eventType: event.eventName,
      pushEligible: true,
      reservationId: null,
      entryId: p.entryId,
      conversationId: null,
      restaurantId: p.restaurantId,
      branchId: p.branchId,
      reservationStartTime: null,
    };
  }

  if (event instanceof ReservationNoShowEvent) {
    const p = event.payload;
    return {
      eventType: event.eventName,
      pushEligible: false,
      reservationId: p.reservationId,
      entryId: null,
      conversationId: null,
      restaurantId: p.restaurantId,
      branchId: p.branchId,
      reservationStartTime: null,
    };
  }

  // Phase 15.6 (Messaging, DECISIONS.md D6) - customer-only: only a
  // Restaurant-side sender (Employee/OrganizationMember) notifies the
  // Customer participant. A Customer-sent message never notifies anyone
  // (staff visibility is realtime-only, D9); a System-sent message is
  // likewise excluded. No Employee/OrganizationMember ever receives a
  // Notification row for messaging.
  if (event instanceof MessageSentEvent) {
    const p = event.payload;
    if (p.senderType === MessageSenderType.Customer || p.senderType === MessageSenderType.System) {
      return null;
    }
    return {
      eventType: event.eventName,
      pushEligible: true,
      reservationId: null,
      entryId: null,
      conversationId: p.conversationId,
      restaurantId: p.restaurantId,
      branchId: p.branchId,
      reservationStartTime: null,
    };
  }

  // GuestLateArrivalNotified / ReservationExpired: explicitly excluded
  // (decision item 17, owner-confirmed 2026-07-25) - falls through to the
  // default-deny below along with every other unmapped event.
  return null;
}

/**
 * Phase 9 (architecture frozen 2026-07-25) application-layer orchestration -
 * consumed by `NotifyingEventPublisher`, the outermost `EVENT_PUBLISHER`
 * decorator, for every event already flowing through the existing publisher
 * chain (decision item 11: "Do not bypass the existing event publisher
 * architecture"). Pipeline: resolve intent -> resolve recipient `User` (a
 * guest-backed source Reservation/WaitlistEntry has no recipient in v1 - a
 * silent no-op, never an error, decision items 2/3) -> resolve
 * `NotificationTemplate` (In-App channel; Push channel is resolved lazily by
 * `ProcessNotificationDeliveryUseCase` at send time instead, since Push and
 * In-App content are independent per LOCALIZATION.md) -> persist the durable
 * `Notification` row -> if push-eligible AND `User.notificationOptIn`,
 * enqueue `NotificationQueue` (decision item 16 - opt-out never suppresses
 * the durable In-App row, only the Push attempt).
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(RESERVATION_WAITLIST_ENTRY_REPOSITORY)
    private readonly waitlistEntryRepository: ReservationWaitlistEntryRepository,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notificationRepository: NotificationRepository,
    @Inject(NOTIFICATION_TEMPLATE_REPOSITORY)
    private readonly templateRepository: NotificationTemplateRepository,
    @Inject(NOTIFICATION_DELIVERY_SCHEDULER)
    private readonly deliveryScheduler: NotificationDeliverySchedulerPort,
    @Inject(CONVERSATION_PARTICIPANT_REPOSITORY)
    private readonly conversationParticipantRepository: ConversationParticipantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  /**
   * Returns the `NotificationCreatedEvent` to publish through the rest of
   * the chain (audit + realtime), or `null` if this event produced no
   * notification (not on the allow-list, or no eligible `User` recipient).
   * Never throws for a business/data reason (missing recipient, missing
   * template) - only for a genuine infrastructure failure, which
   * `NotifyingEventPublisher` catches and swallows (never breaks the
   * triggering business transaction, mirroring `RealtimeEventPublisher`'s
   * own "a broadcast failure must never be rethrown" contract).
   */
  async dispatch(event: DomainEvent): Promise<NotificationCreatedEvent | null> {
    const intent = resolveNotificationIntent(event);
    if (intent === null) {
      return null;
    }

    const userId = await this.resolveRecipientUserId(intent);
    if (userId === null) {
      return null;
    }

    const user = await this.userRepository.findById(userId);
    if (user === null) {
      this.logger.warn(
        `NotificationDispatcher: recipient User ${userId.value} not found for ${intent.eventType} - skipping.`,
      );
      return null;
    }

    const inAppTemplate = await this.resolveTemplate(
      intent.eventType,
      user.language,
      NotificationChannel.InApp,
    );
    if (inAppTemplate === null) {
      this.logger.error(
        `NotificationDispatcher: no NotificationTemplate (including default) for eventType=${intent.eventType} channel=InApp - notification not created. Seed data is missing.`,
      );
      return null;
    }

    const now = this.clock.now();
    let notification = Notification.create({
      id: this.idGenerator.generate(),
      userId: userId.value,
      type: intent.eventType,
      templateId: inAppTemplate.id,
      title: inAppTemplate.title,
      body: inAppTemplate.body,
      data: this.buildData(intent),
      now,
    });

    const pushEligible = intent.pushEligible && user.notificationOptIn;
    if (pushEligible) {
      notification = notification.enqueuePush(this.idGenerator.generate(), now);
    }

    await this.notificationRepository.save(notification);

    if (pushEligible) {
      try {
        await this.deliveryScheduler.enqueueDelivery(notification.id, event.correlationId);
      } catch (error) {
        // Accepted Phase 9 v1 reliability boundary (decision item 11/12):
        // the durable Notification row already survived - only this Push
        // attempt is lost. Never rethrown; never breaks the triggering
        // business transaction.
        this.logger.error(
          `NotificationDispatcher: failed to enqueue NotificationQueue delivery for ${notification.id}: ${(error as Error).message}`,
        );
      }
    }

    return new NotificationCreatedEvent(
      this.idGenerator.generate(),
      {
        notificationId: notification.id,
        userId: userId.value,
        type: intent.eventType,
        reservationId: intent.reservationId,
        correlationId: event.correlationId,
      },
      now,
    );
  }

  private async resolveRecipientUserId(intent: NotificationIntent): Promise<UserId | null> {
    if (intent.reservationId !== null) {
      const reservation = await this.reservationRepository.findById(
        ReservationId.create(intent.reservationId),
      );
      return reservation?.userId ?? null;
    }
    if (intent.entryId !== null) {
      const entry = await this.waitlistEntryRepository.findById(intent.entryId);
      return entry?.userId ?? null;
    }
    if (intent.conversationId !== null) {
      const participant = await this.conversationParticipantRepository.findCustomerParticipant(
        ConversationId.create(intent.conversationId),
      );
      return participant?.userId ?? null;
    }
    return null;
  }

  private buildData(intent: NotificationIntent): Record<string, unknown> {
    if (intent.conversationId !== null) {
      return {
        conversationId: intent.conversationId,
        restaurantId: intent.restaurantId,
        branchId: intent.branchId,
      };
    }
    if (intent.entryId !== null) {
      return {
        entryId: intent.entryId,
        restaurantId: intent.restaurantId,
        branchId: intent.branchId,
      };
    }
    if (intent.reservationStartTime !== null) {
      return {
        reservationId: intent.reservationId,
        restaurantId: intent.restaurantId,
        branchId: intent.branchId,
        reservationStartTime: intent.reservationStartTime,
      };
    }
    return { reservationId: intent.reservationId };
  }

  private async resolveTemplate(
    eventType: string,
    language: string,
    channel: NotificationChannel,
  ): Promise<NotificationTemplate | null> {
    const exact = await this.templateRepository.findExact(eventType, language, channel);
    if (exact !== null) {
      return exact;
    }
    const fallback = await this.templateRepository.findDefault(eventType, channel);
    if (fallback !== null) {
      this.logger.log(
        `NotificationDispatcher: no ${channel} template for eventType=${eventType} language=${language} - using default.`,
      );
    }
    return fallback;
  }
}
