import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { RestaurantSlug } from '@shared/domain/value-objects/restaurant-slug.vo';
import {
  SubscriptionRepository,
  SUBSCRIPTION_REPOSITORY,
} from '@modules/subscriptions/domain/repositories/subscription.repository';
import {
  SubscriptionPlanRepository,
  SUBSCRIPTION_PLAN_REPOSITORY,
} from '@modules/subscriptions/domain/repositories/subscription-plan.repository';
import {
  SubscriptionUsageRepository,
  SUBSCRIPTION_USAGE_REPOSITORY,
} from '@modules/subscriptions/domain/repositories/subscription-usage.repository';
import { SubscriptionPolicy } from '@modules/subscriptions/domain/services/subscription-policy';
import { SubscriptionNotFoundException } from '@modules/subscriptions/domain/exceptions/subscription-not-found.exception';
import { SubscriptionPlanNotFoundException } from '@modules/subscriptions/domain/exceptions/subscription-plan-not-found.exception';
import { OrganizationLimitExceededException } from '@modules/subscriptions/domain/exceptions/organization-limit-exceeded.exception';
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
import { RestaurantUsage } from '../../domain/entities/restaurant-usage.entity';
import {
  RestaurantUsageRepository,
  RESTAURANT_USAGE_REPOSITORY,
} from '../../domain/repositories/restaurant-usage.repository';
import { RestaurantSlugAlreadyExistsException } from '../../domain/exceptions/restaurant-slug-already-exists.exception';
import { RestaurantCreatedEvent } from '../../domain/events/restaurant.events';
import { resolveRestaurantSlug } from '../utils/restaurant-slug.util';
import { toRestaurantResult } from '../mappers/restaurant-result.mapper';
import { CreateRestaurantCommand } from '../dto/create-restaurant.command';
import { RestaurantResult } from '../dto/restaurant.result';

/**
 * Phase 12 (Subscriptions, ADR-027 §8/D14): the first of the three frozen
 * enforcement points. `maxRestaurants` is Organization-wide - checked via
 * `SubscriptionUsageRepository`'s atomic conditional increment (D15) inside
 * the SAME transaction as the Restaurant/RestaurantSettings/RestaurantUsage
 * inserts, so two concurrent requests at `limit - 1` can never both
 * succeed. `SubscriptionPolicy.assertPermitsResourceCreation` is an eager,
 * clear-error-message check before attempting the atomic increment - the
 * increment itself is the actual concurrency authority.
 */
@Injectable()
export class CreateRestaurantUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESTAURANT_SETTINGS_REPOSITORY)
    private readonly restaurantSettingsRepository: RestaurantSettingsRepository,
    @Inject(RESTAURANT_USAGE_REPOSITORY)
    private readonly restaurantUsageRepository: RestaurantUsageRepository,
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptionRepository: SubscriptionRepository,
    @Inject(SUBSCRIPTION_PLAN_REPOSITORY)
    private readonly subscriptionPlanRepository: SubscriptionPlanRepository,
    @Inject(SUBSCRIPTION_USAGE_REPOSITORY)
    private readonly subscriptionUsageRepository: SubscriptionUsageRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: CreateRestaurantCommand): Promise<RestaurantResult> {
    const slug = RestaurantSlug.create(resolveRestaurantSlug(command.name, command.slug));

    if (await this.restaurantRepository.existsBySlug(slug)) {
      throw new RestaurantSlugAlreadyExistsException(slug);
    }

    const subscription = await this.subscriptionRepository.findByOrganizationId();
    if (subscription === null) {
      throw new SubscriptionNotFoundException();
    }
    SubscriptionPolicy.assertPermitsResourceCreation(subscription);
    const plan = await this.subscriptionPlanRepository.findById(subscription.subscriptionPlanId);
    if (plan === null) {
      throw new SubscriptionPlanNotFoundException();
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

    // Every Restaurant requires exactly one RestaurantSettings row
    // (DATABASE_SCHEMA.md's unique restaurantId constraint) - created here,
    // atomically alongside the Restaurant itself, per Phase 4.2's scope
    // decision (see TASKS.md's Phase 4.2 report) rather than lazily on
    // first access, so no consumer of this aggregate ever has to handle a
    // "restaurant exists but has no settings" state. Both saves run inside
    // one transaction so a failure after the Restaurant write can never
    // leave it without a RestaurantSettings row.
    const settings = RestaurantSettings.createDefault(
      this.idGenerator.generate(),
      restaurant.restaurantId.value,
      now,
    );
    const usage = RestaurantUsage.create({
      id: this.idGenerator.generate(),
      restaurantId: restaurant.restaurantId.value,
      now,
    });

    await this.unitOfWork.execute(async () => {
      // D15 - the atomic conditional increment is the actual concurrency
      // authority: two concurrent requests both observing
      // restaurantCount = limit - 1 cannot both succeed here, since the
      // second writer's conditional UPDATE affects zero rows once the first
      // has committed its increment.
      const withinLimit =
        await this.subscriptionUsageRepository.incrementRestaurantCountIfUnderLimit(
          command.actor.organizationId,
          plan.maxRestaurants,
        );
      if (!withinLimit) {
        throw new OrganizationLimitExceededException('maxRestaurants');
      }
      await this.restaurantRepository.save(restaurant);
      await this.restaurantSettingsRepository.save(settings);
      await this.restaurantUsageRepository.create(usage);
    });

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
