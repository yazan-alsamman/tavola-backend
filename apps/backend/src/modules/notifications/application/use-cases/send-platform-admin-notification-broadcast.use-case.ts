import { Inject, Injectable } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { CreateNotificationBroadcastService } from '../services/create-notification-broadcast.service';
import { NotificationBroadcastSenderType } from '../../domain/enums/notification-broadcast.enums';
import { PlatformAdminNotificationBroadcastRequestedEvent } from '../../domain/events/notification-broadcast.events';

export interface SendPlatformAdminNotificationBroadcastCommand {
  adminId: string;
  title: string;
  body: string;
  correlationId?: string;
}

export interface SendNotificationBroadcastResult {
  broadcastId: string;
  totalRecipients: number;
}

/** Phase 19.9 (ADR-037) — Platform Admin -> all eligible Customers. */
@Injectable()
export class SendPlatformAdminNotificationBroadcastUseCase {
  constructor(
    private readonly createNotificationBroadcast: CreateNotificationBroadcastService,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(
    command: SendPlatformAdminNotificationBroadcastCommand,
  ): Promise<SendNotificationBroadcastResult> {
    const { broadcastId, totalRecipients } = await this.createNotificationBroadcast.execute({
      senderType: NotificationBroadcastSenderType.PlatformAdmin,
      senderId: command.adminId,
      organizationId: null,
      title: command.title,
      body: command.body,
      correlationId: command.correlationId,
    });

    await this.eventPublisher.publish(
      new PlatformAdminNotificationBroadcastRequestedEvent(
        this.idGenerator.generate(),
        {
          broadcastId,
          adminId: command.adminId,
          title: command.title,
          totalRecipients,
          correlationId: command.correlationId,
        },
        this.clock.now(),
        command.correlationId,
      ),
    );

    return { broadcastId, totalRecipients };
  }
}
