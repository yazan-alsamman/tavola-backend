import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { RestaurantSlug } from '@shared/domain/value-objects/restaurant-slug.vo';
import {
  CLOCK,
  ID_GENERATOR,
  EVENT_PUBLISHER,
} from '@modules/authentication/domain/tokens/authentication.tokens';
import { Restaurant } from '../../domain/entities/restaurant.entity';
import { RestaurantStatus } from '../../domain/enums/restaurant.enums';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import { RestaurantSettings } from '../../domain/entities/restaurant-settings.entity';
import {
  RestaurantSettingsRepository,
  RESTAURANT_SETTINGS_REPOSITORY,
} from '../../domain/repositories/restaurant-settings.repository';
import { RestaurantSlugAlreadyExistsException } from '../../domain/exceptions/restaurant-slug-already-exists.exception';
import { RestaurantCreatedEvent } from '../../domain/events/restaurant.events';
import { resolveRestaurantSlug } from '../utils/restaurant-slug.util';
import { toRestaurantResult } from '../mappers/restaurant-result.mapper';
import { CreateRestaurantCommand } from '../dto/create-restaurant.command';
import { RestaurantResult } from '../dto/restaurant.result';

@Injectable()
export class CreateRestaurantUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESTAURANT_SETTINGS_REPOSITORY)
    private readonly restaurantSettingsRepository: RestaurantSettingsRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: CreateRestaurantCommand): Promise<RestaurantResult> {
    const slug = RestaurantSlug.create(resolveRestaurantSlug(command.name, command.slug));

    if (await this.restaurantRepository.existsBySlug(slug)) {
      throw new RestaurantSlugAlreadyExistsException(slug);
    }

    const now = this.clock.now();
    const restaurant = Restaurant.create({
      id: this.idGenerator.generate(),
      organizationId: command.actor.organizationId,
      name: command.name,
      slug: slug.value,
      logoId: null,
      coverImageId: null,
      description: command.description,
      cuisineType: command.cuisineType,
      averageRating: null,
      priceLevel: command.priceLevel,
      status: RestaurantStatus.Active,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    await this.restaurantRepository.save(restaurant);

    // Every Restaurant requires exactly one RestaurantSettings row
    // (DATABASE_SCHEMA.md's unique restaurantId constraint) - created here,
    // atomically alongside the Restaurant itself, per Phase 4.2's scope
    // decision (see TASKS.md's Phase 4.2 report) rather than lazily on
    // first access, so no consumer of this aggregate ever has to handle a
    // "restaurant exists but has no settings" state.
    const settings = RestaurantSettings.createDefault(
      this.idGenerator.generate(),
      restaurant.restaurantId.value,
      now,
    );
    await this.restaurantSettingsRepository.save(settings);

    await this.eventPublisher.publish(
      new RestaurantCreatedEvent(
        this.idGenerator.generate(),
        {
          restaurantId: restaurant.restaurantId.value,
          organizationId: restaurant.organizationId.value,
          actorId: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );

    return toRestaurantResult(restaurant);
  }
}
