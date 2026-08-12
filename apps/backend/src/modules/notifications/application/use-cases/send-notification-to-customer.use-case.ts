import { Inject, Injectable } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { Notification } from '../../domain/entities/notification.entity';
import {
  NOTIFICATION_REPOSITORY,
  NotificationRepository,
} from '../../domain/repositories/notification.repository';
import { NotificationCreatedEvent } from '../../domain/events/notification.events';
import { PlatformAdminNotificationSentEvent } from '../../domain/events/platform-admin-notification-sent.event';
import { CustomerNotFoundException } from '../../domain/exceptions/customer-not-found.exception';
import {
  CUSTOMER_AUDIENCE_READER,
  CustomerAudienceReaderPort,
} from '../ports/customer-audience-reader.port';

export interface SendNotificationToCustomerCommand {
  adminId: string;
  targetUserId: string;
  title: string;
  body: string;
  correlationId?: string;
}

export interface SendNotificationToCustomerResult {
  notificationId: string;
}

/**
 * Phase 19.9 (ADR-037) — Platform Admin -> one Customer. Reuses the
 * single-entity `Notification.create()` + `save()` + `NotificationCreatedEvent`
 * path exactly like `NotificationDispatcher` does (so it gets the existing
 * realtime `user:{userId}` room hint and the existing generic
 * `actorType: 'System'` audit row for free), plus one new
 * `PlatformAdminNotificationSentEvent` for a properly actor-attributed audit
 * row. No `NotificationTemplate` involved - the Admin supplies `title`/`body`
 * directly (`templateId: null`), and no Push (OneSignal) delivery is
 * attempted - the approved product scope for this feature is durable
 * persistence + Socket.IO realtime only.
 */
@Injectable()
export class SendNotificationToCustomerUseCase {
  constructor(
    @Inject(CUSTOMER_AUDIENCE_READER)
    private readonly customerAudienceReader: CustomerAudienceReaderPort,
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notificationRepository: NotificationRepository,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(
    command: SendNotificationToCustomerCommand,
  ): Promise<SendNotificationToCustomerResult> {
    const isEligible = await this.customerAudienceReader.isEligibleCustomer(command.targetUserId);
    if (!isEligible) {
      throw new CustomerNotFoundException();
    }

    const now = this.clock.now();
    const notification = Notification.create({
      id: this.idGenerator.generate(),
      userId: command.targetUserId,
      type: 'PlatformAdminDirectMessage',
      templateId: null,
      title: command.title,
      body: command.body,
      data: null,
      now,
    });

    await this.notificationRepository.save(notification);

    await this.eventPublisher.publishAll([
      new NotificationCreatedEvent(
        this.idGenerator.generate(),
        {
          notificationId: notification.id,
          userId: command.targetUserId,
          type: notification.type,
          reservationId: null,
          correlationId: command.correlationId,
        },
        now,
      ),
      new PlatformAdminNotificationSentEvent(
        this.idGenerator.generate(),
        {
          adminId: command.adminId,
          notificationId: notification.id,
          targetUserId: command.targetUserId,
          correlationId: command.correlationId,
        },
        now,
        command.correlationId,
      ),
    ]);

    return { notificationId: notification.id };
  }
}
