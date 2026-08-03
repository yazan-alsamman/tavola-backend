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
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  RestaurantUsageRepository,
  RESTAURANT_USAGE_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-usage.repository';
import {
  SubscriptionRepository,
  SUBSCRIPTION_REPOSITORY,
} from '@modules/subscriptions/domain/repositories/subscription.repository';
import {
  SubscriptionPlanRepository,
  SUBSCRIPTION_PLAN_REPOSITORY,
} from '@modules/subscriptions/domain/repositories/subscription-plan.repository';
import { SubscriptionPolicy } from '@modules/subscriptions/domain/services/subscription-policy';
import { SubscriptionNotFoundException } from '@modules/subscriptions/domain/exceptions/subscription-not-found.exception';
import { SubscriptionPlanNotFoundException } from '@modules/subscriptions/domain/exceptions/subscription-plan-not-found.exception';
import { OrganizationLimitExceededException } from '@modules/subscriptions/domain/exceptions/organization-limit-exceeded.exception';
import { Branch } from '../../domain/entities/branch.entity';
import { BranchRepository, BRANCH_REPOSITORY } from '../../domain/repositories/branch.repository';
import { BranchCreatedEvent } from '../../domain/events/branch.events';
import { toBranchResult } from '../mappers/branch-result.mapper';
import { CreateBranchCommand } from '../dto/create-branch.command';
import { BranchResult } from '../dto/branch.result';

/**
 * Phase 12 (Subscriptions, ADR-027 §8/D14): `maxBranchesPerRestaurant` is
 * per-Restaurant (D5/D16) - enforced via `RestaurantUsageRepository`'s
 * atomic conditional increment (D15) keyed to THIS restaurant's own row,
 * never an Organization-wide sum, inside the same transaction as the
 * Branch insert.
 */
@Injectable()
export class CreateBranchUseCase {
  constructor(
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESTAURANT_USAGE_REPOSITORY)
    private readonly restaurantUsageRepository: RestaurantUsageRepository,
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptionRepository: SubscriptionRepository,
    @Inject(SUBSCRIPTION_PLAN_REPOSITORY)
    private readonly subscriptionPlanRepository: SubscriptionPlanRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: CreateBranchCommand): Promise<BranchResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate: Branch carries no organizationId of its own
    // (TENANCY.md's "transitively tenant-owned" case, same as
    // RestaurantSettings/WorkingHours) - resolving the parent Restaurant
    // through the already-tenant-scoped RestaurantRepository first is what
    // makes this call safe. A restaurant belonging to another organization
    // resolves to null here exactly like any other cross-tenant lookup.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
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
    const branch = Branch.create({
      id: this.idGenerator.generate(),
      restaurantId: restaurantId.value,
      city: command.city,
      district: command.district,
      address: command.address,
      latitude: command.latitude,
      longitude: command.longitude,
      countryCode: command.countryCode,
      currency: command.currency,
      timezone: command.timezone,
      phone: command.phone,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    await this.unitOfWork.execute(async () => {
      const withinLimit = await this.restaurantUsageRepository.incrementBranchCountIfUnderLimit(
        restaurantId,
        plan.maxBranchesPerRestaurant,
      );
      if (!withinLimit) {
        throw new OrganizationLimitExceededException('maxBranchesPerRestaurant');
      }
      await this.branchRepository.save(branch);
    });

    await this.eventPublisher.publish(
      new BranchCreatedEvent(
        this.idGenerator.generate(),
        {
          branchId: branch.branchId.value,
          restaurantId: restaurantId.value,
          organizationId: restaurant.organizationId.value,
          actorId: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );

    return toBranchResult(branch);
  }
}
