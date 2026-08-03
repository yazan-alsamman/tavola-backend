import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import {
  RestaurantOccasionCategoryRepository,
  RESTAURANT_OCCASION_CATEGORY_REPOSITORY,
} from '../../domain/repositories/restaurant-occasion-category.repository';
import {
  OccasionCategoryRepository,
  OCCASION_CATEGORY_REPOSITORY,
} from '../../domain/repositories/occasion-category.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { UnknownOccasionCategoryException } from '../../domain/exceptions/unknown-occasion-category.exception';
import { RestaurantOccasionCategory } from '../../domain/entities/restaurant-occasion-category.entity';
import { toOccasionCategoryResult } from '../mappers/occasion-category-result.mapper';
import { SetRestaurantOccasionCategoriesCommand } from '../dto/set-restaurant-occasion-categories.command';
import { RestaurantOccasionCategoriesResult } from '../dto/restaurant-occasion-categories.result';

@Injectable()
export class SetRestaurantOccasionCategoriesUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESTAURANT_OCCASION_CATEGORY_REPOSITORY)
    private readonly restaurantOccasionCategoryRepository: RestaurantOccasionCategoryRepository,
    @Inject(OCCASION_CATEGORY_REPOSITORY)
    private readonly occasionCategoryRepository: OccasionCategoryRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(
    command: SetRestaurantOccasionCategoriesCommand,
  ): Promise<RestaurantOccasionCategoriesResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate - see GetRestaurantCuisineCategoriesUseCase's own
    // comment.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const uniqueIds = Array.from(new Set(command.occasionCategoryIds));

    const categories = await this.occasionCategoryRepository.findByIds(uniqueIds);
    const activeCategories = categories.filter((category) => category.isActive);
    if (activeCategories.length !== uniqueIds.length) {
      throw new UnknownOccasionCategoryException();
    }

    const now = this.clock.now();
    // Full-replace semantics (matching UpdateWorkingHoursUseCase): the
    // submitted ids become the entire assignment set.
    const assignments = uniqueIds.map((occasionCategoryId) =>
      RestaurantOccasionCategory.create({
        id: this.idGenerator.generate(),
        restaurantId: restaurantId.value,
        occasionCategoryId,
        createdAt: now,
      }),
    );

    await this.restaurantOccasionCategoryRepository.replaceAllForRestaurant(
      restaurantId,
      assignments,
    );

    // EVENTS.md has no named "RestaurantOccasionCategory" domain event class
    // - follows UpdateWorkingHoursUseCase's own precedent (direct audit
    // write, no invented domain event class).
    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'restaurant.occasion_categories.updated',
      targetType: 'Restaurant',
      targetId: restaurantId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    return {
      restaurantId: restaurantId.value,
      categories: [...activeCategories]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((category) => toOccasionCategoryResult(category)),
    };
  }
}
