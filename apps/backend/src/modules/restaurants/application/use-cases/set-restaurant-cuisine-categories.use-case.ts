import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { CLOCK, ID_GENERATOR } from '@modules/authentication/domain/tokens/authentication.tokens';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import {
  RestaurantCuisineCategoryRepository,
  RESTAURANT_CUISINE_CATEGORY_REPOSITORY,
} from '../../domain/repositories/restaurant-cuisine-category.repository';
import {
  CuisineCategoryRepository,
  CUISINE_CATEGORY_REPOSITORY,
} from '../../domain/repositories/cuisine-category.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { UnknownCuisineCategoryException } from '../../domain/exceptions/unknown-cuisine-category.exception';
import { RestaurantCuisineCategory } from '../../domain/entities/restaurant-cuisine-category.entity';
import { toCuisineCategoryResult } from '../mappers/cuisine-category-result.mapper';
import { SetRestaurantCuisineCategoriesCommand } from '../dto/set-restaurant-cuisine-categories.command';
import { RestaurantCuisineCategoriesResult } from '../dto/restaurant-cuisine-categories.result';

@Injectable()
export class SetRestaurantCuisineCategoriesUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESTAURANT_CUISINE_CATEGORY_REPOSITORY)
    private readonly restaurantCuisineCategoryRepository: RestaurantCuisineCategoryRepository,
    @Inject(CUISINE_CATEGORY_REPOSITORY)
    private readonly cuisineCategoryRepository: CuisineCategoryRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(
    command: SetRestaurantCuisineCategoriesCommand,
  ): Promise<RestaurantCuisineCategoriesResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate - see GetRestaurantCuisineCategoriesUseCase's own
    // comment.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const uniqueIds = Array.from(new Set(command.cuisineCategoryIds));

    const categories = await this.cuisineCategoryRepository.findByIds(uniqueIds);
    const activeCategories = categories.filter((category) => category.isActive);
    if (activeCategories.length !== uniqueIds.length) {
      throw new UnknownCuisineCategoryException();
    }

    const now = this.clock.now();
    // Full-replace semantics (matching UpdateWorkingHoursUseCase): the
    // submitted ids become the entire assignment set.
    const assignments = uniqueIds.map((cuisineCategoryId) =>
      RestaurantCuisineCategory.create({
        id: this.idGenerator.generate(),
        restaurantId: restaurantId.value,
        cuisineCategoryId,
        createdAt: now,
      }),
    );

    await this.restaurantCuisineCategoryRepository.replaceAllForRestaurant(
      restaurantId,
      assignments,
    );

    // EVENTS.md has no named "RestaurantCuisineCategory" domain event class -
    // follows UpdateWorkingHoursUseCase's own precedent (direct audit write,
    // no invented domain event class).
    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'restaurant.cuisine_categories.updated',
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
        .map((category) => toCuisineCategoryResult(category)),
    };
  }
}
