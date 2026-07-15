import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CLOCK,
  ID_GENERATOR,
  EVENT_PUBLISHER,
} from '@modules/authentication/domain/tokens/authentication.tokens';
import { RestaurantStatus } from '../../domain/enums/restaurant.enums';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import {
  RestaurantActivatedEvent,
  RestaurantSuspendedEvent,
  RestaurantUpdatedEvent,
} from '../../domain/events/restaurant.events';
import { toRestaurantResult } from '../mappers/restaurant-result.mapper';
import { UpdateRestaurantCommand } from '../dto/update-restaurant.command';
import { RestaurantResult } from '../dto/restaurant.result';

@Injectable()
export class UpdateRestaurantUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: UpdateRestaurantCommand): Promise<RestaurantResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const now = this.clock.now();
    const statusChanged = command.status !== restaurant.status;

    let updated = restaurant.updateProfile(
      {
        name: command.name,
        description: command.description,
        cuisineType: command.cuisineType,
        priceLevel: command.priceLevel,
      },
      now,
    );

    if (statusChanged) {
      updated =
        command.status === RestaurantStatus.Active ? updated.activate(now) : updated.suspend(now);
    }

    await this.restaurantRepository.save(updated);

    const payload = {
      restaurantId: updated.restaurantId.value,
      organizationId: updated.organizationId.value,
      actorId: command.actor.userId,
    };

    // A status transition is a more specific fact than "some field changed" -
    // publish the dedicated lifecycle event instead of the generic one for
    // that transition, matching the AccountLockedEvent precedent
    // (TASKS.md Phase 2.19). Both never fire for the same update.
    if (statusChanged) {
      const event =
        command.status === RestaurantStatus.Active
          ? new RestaurantActivatedEvent(
              this.idGenerator.generate(),
              payload,
              now,
              command.correlationId,
            )
          : new RestaurantSuspendedEvent(
              this.idGenerator.generate(),
              payload,
              now,
              command.correlationId,
            );
      await this.eventPublisher.publish(event);
    } else {
      await this.eventPublisher.publish(
        new RestaurantUpdatedEvent(
          this.idGenerator.generate(),
          payload,
          now,
          command.correlationId,
        ),
      );
    }

    return toRestaurantResult(updated);
  }
}
