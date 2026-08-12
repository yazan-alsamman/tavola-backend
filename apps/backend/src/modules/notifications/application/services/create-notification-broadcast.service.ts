import { Inject, Injectable } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import { NotificationBroadcast } from '../../domain/entities/notification-broadcast.entity';
import { NotificationBroadcastSenderType } from '../../domain/enums/notification-broadcast.enums';
import {
  NOTIFICATION_BROADCAST_REPOSITORY,
  NotificationBroadcastRepository,
} from '../../domain/repositories/notification-broadcast.repository';
import {
  CUSTOMER_AUDIENCE_READER,
  CustomerAudienceReaderPort,
} from '../ports/customer-audience-reader.port';
import {
  NOTIFICATION_BROADCAST_FANOUT_SCHEDULER,
  NotificationBroadcastFanoutSchedulerPort,
} from '../ports/notification-broadcast-fanout-scheduler.port';

export interface CreateNotificationBroadcastParams {
  senderType: NotificationBroadcastSenderType;
  senderId: string;
  organizationId: string | null;
  title: string;
  body: string;
  correlationId?: string;
}

export interface CreateNotificationBroadcastResult {
  broadcastId: string;
  totalRecipients: number;
}

/**
 * Phase 19.9 (ADR-037) — the one shared path both
 * `SendPlatformAdminNotificationBroadcastUseCase` and
 * `SendRestaurantOwnerNotificationBroadcastUseCase` delegate into: resolve
 * the (global) audience size, persist the `NotificationBroadcast` row
 * (status `Pending`), enqueue the BullMQ kickoff job. Deliberately does NOT
 * publish the actor-attributed audit event itself - the two callers do that,
 * since `PlatformAdminNotificationBroadcastRequestedEvent`/
 * `RestaurantOwnerNotificationBroadcastRequestedEvent` have different payload
 * shapes (ADR-037 Decision #6's "not a single combined use case" choice).
 */
@Injectable()
export class CreateNotificationBroadcastService {
  constructor(
    @Inject(CUSTOMER_AUDIENCE_READER)
    private readonly customerAudienceReader: CustomerAudienceReaderPort,
    @Inject(NOTIFICATION_BROADCAST_REPOSITORY)
    private readonly broadcastRepository: NotificationBroadcastRepository,
    @Inject(NOTIFICATION_BROADCAST_FANOUT_SCHEDULER)
    private readonly fanoutScheduler: NotificationBroadcastFanoutSchedulerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(
    params: CreateNotificationBroadcastParams,
  ): Promise<CreateNotificationBroadcastResult> {
    const totalRecipients = await this.customerAudienceReader.countBroadcastEligibleCustomers();

    const broadcast = NotificationBroadcast.create({
      id: this.idGenerator.generate(),
      senderType: params.senderType,
      senderId: params.senderId,
      organizationId: params.organizationId,
      title: params.title,
      body: params.body,
      totalRecipients,
      now: this.clock.now(),
    });

    await this.broadcastRepository.save(broadcast);
    await this.fanoutScheduler.enqueueFanout(broadcast.id, params.correlationId);

    return { broadcastId: broadcast.id, totalRecipients };
  }
}
