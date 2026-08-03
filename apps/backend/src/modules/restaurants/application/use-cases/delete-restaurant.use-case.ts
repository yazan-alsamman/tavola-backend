import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  SubscriptionUsageRepository,
  SUBSCRIPTION_USAGE_REPOSITORY,
} from '@modules/subscriptions/domain/repositories/subscription-usage.repository';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { RestaurantDeletedEvent } from '../../domain/events/restaurant.events';
import { DeleteRestaurantCommand } from '../dto/delete-restaurant.command';

/** Phase 12 (Subscriptions, ADR-027 §11): decrements `SubscriptionUsage.restaurantCount` in the same transaction as the Restaurant's own soft-delete - never below zero (repository-guarded). */
@Injectable()
export class DeleteRestaurantUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(SUBSCRIPTION_USAGE_REPOSITORY)
    private readonly subscriptionUsageRepository: SubscriptionUsageRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: DeleteRestaurantCommand): Promise<void> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const now = this.clock.now();
    const deleted = restaurant.softDelete(now);
    await this.unitOfWork.execute(async () => {
      await this.restaurantRepository.save(deleted);
      await this.subscriptionUsageRepository.decrementRestaurantCount(command.actor.organizationId);
    });

    await this.eventPublisher.publish(
      new RestaurantDeletedEvent(
        this.idGenerator.generate(),
        {
          restaurantId: deleted.restaurantId.value,
          organizationId: deleted.organizationId.value,
          actorId: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );
  }
}
