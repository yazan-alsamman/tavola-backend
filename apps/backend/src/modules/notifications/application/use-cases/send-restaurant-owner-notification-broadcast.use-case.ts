import { Inject, Injectable } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { CreateNotificationBroadcastService } from '../services/create-notification-broadcast.service';
import { NotificationBroadcastSenderType } from '../../domain/enums/notification-broadcast.enums';
import { RestaurantOwnerNotificationBroadcastRequestedEvent } from '../../domain/events/notification-broadcast.events';
import { SendNotificationBroadcastResult } from './send-platform-admin-notification-broadcast.use-case';

export interface SendRestaurantOwnerNotificationBroadcastCommand {
  ownerId: string;
  organizationId: string;
  restaurantId: string;
  title: string;
  body: string;
  correlationId?: string;
}

/**
 * Phase 19.9 (ADR-037) — Restaurant Owner -> all eligible Customers.
 * `restaurantId` is authorization-scoping/attribution only: the tenant-scoped
 * `RestaurantRepository.findById` (ambient `TenantContext` already bound by
 * `TenantContextInterceptor` from the caller's own JWT `organizationId`,
 * exactly like `CreateOfferUseCase`) returns `null` for a restaurant that
 * does not exist OR belongs to a different Organization - both collapse to
 * the same `RestaurantNotFoundException` (404), the established IDOR-safe
 * convention. Per the Owner's explicit product decision (ADR-037 Decision
 * #4), the *audience* itself is never derived from this restaurant - it is
 * the identical global "all eligible Customers" set
 * `SendPlatformAdminNotificationBroadcastUseCase` uses.
 */
@Injectable()
export class SendRestaurantOwnerNotificationBroadcastUseCase {
  constructor(
    private readonly createNotificationBroadcast: CreateNotificationBroadcastService,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(
    command: SendRestaurantOwnerNotificationBroadcastCommand,
  ): Promise<SendNotificationBroadcastResult> {
    const restaurant = await this.restaurantRepository.findById(
      RestaurantId.create(command.restaurantId),
    );
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const { broadcastId, totalRecipients } = await this.createNotificationBroadcast.execute({
      senderType: NotificationBroadcastSenderType.OrganizationMember,
      senderId: command.ownerId,
      organizationId: command.organizationId,
      title: command.title,
      body: command.body,
      correlationId: command.correlationId,
    });

    await this.eventPublisher.publish(
      new RestaurantOwnerNotificationBroadcastRequestedEvent(
        this.idGenerator.generate(),
        {
          broadcastId,
          ownerId: command.ownerId,
          organizationId: command.organizationId,
          restaurantId: command.restaurantId,
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
