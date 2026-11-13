import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { RestaurantStatus } from '../../domain/enums/restaurant.enums';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import { Restaurant } from '../../domain/entities/restaurant.entity';
import {
  RestaurantTextsInput,
  resolveRestaurantTexts,
} from '../../domain/services/restaurant-texts';
import { InvalidRestaurantProfileException } from '../../domain/exceptions/invalid-restaurant-profile.exception';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import {
  RestaurantActivatedEvent,
  RestaurantSuspendedEvent,
  RestaurantUpdatedEvent,
} from '../../domain/events/restaurant.events';
import { toRestaurantResult } from '../mappers/restaurant-result.mapper';
import { UpdateRestaurantCommand } from '../dto/update-restaurant.command';
import { RestaurantResult } from '../dto/restaurant.result';

/**
 * A client that predates ADR-052 sends only `name`/`description`. When that
 * text is unchanged, the stored translations are kept rather than rebuilt
 * from the single field, so an old client never erases the other language.
 */
function withKeptTranslations(
  restaurant: Restaurant,
  command: UpdateRestaurantCommand,
): RestaurantTextsInput {
  const input: RestaurantTextsInput = {
    name: command.name,
    nameAr: command.nameAr,
    nameEn: command.nameEn,
    description: command.description,
    descriptionAr: command.descriptionAr,
    descriptionEn: command.descriptionEn,
  };
  if (
    command.nameAr === undefined &&
    command.nameEn === undefined &&
    command.name === restaurant.name
  ) {
    input.nameAr = restaurant.nameAr;
    input.nameEn = restaurant.nameEn;
  }
  if (
    command.descriptionAr === undefined &&
    command.descriptionEn === undefined &&
    command.description === restaurant.description
  ) {
    input.descriptionAr = restaurant.descriptionAr;
    input.descriptionEn = restaurant.descriptionEn;
  }
  return input;
}

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

    const texts = resolveRestaurantTexts(withKeptTranslations(restaurant, command));
    if (texts === null) {
      throw new InvalidRestaurantProfileException('An Arabic or English name is required.');
    }

    let updated = restaurant.updateProfile({ ...texts, cuisineType: command.cuisineType }, now);

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
