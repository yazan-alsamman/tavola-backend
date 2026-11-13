import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CuisineCategoryRepository,
  CUISINE_CATEGORY_REPOSITORY,
} from '@modules/restaurants/domain/repositories/cuisine-category.repository';
import {
  OccasionCategoryRepository,
  OCCASION_CATEGORY_REPOSITORY,
} from '@modules/restaurants/domain/repositories/occasion-category.repository';
import {
  RestaurantCuisineCategoryRepository,
  RESTAURANT_CUISINE_CATEGORY_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-cuisine-category.repository';
import {
  RestaurantOccasionCategoryRepository,
  RESTAURANT_OCCASION_CATEGORY_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-occasion-category.repository';
import { RestaurantCuisineCategory } from '@modules/restaurants/domain/entities/restaurant-cuisine-category.entity';
import { RestaurantOccasionCategory } from '@modules/restaurants/domain/entities/restaurant-occasion-category.entity';
import { UnknownCuisineCategoryException } from '@modules/restaurants/domain/exceptions/unknown-cuisine-category.exception';
import { UnknownOccasionCategoryException } from '@modules/restaurants/domain/exceptions/unknown-occasion-category.exception';
import {
  BranchCategoryRepository,
  BRANCH_CATEGORY_REPOSITORY,
} from '../../domain/repositories/branch-category.repository';
import { BranchAccessService } from '../services/branch-access.service';
import { BranchCategoriesReader } from '../services/branch-categories-reader.service';
import { SetBranchCategoriesCommand } from '../dto/branch-categories.command';
import { BranchCategoriesResult } from '../dto/branch-categories.result';

/**
 * ADR-051: full replace of one branch's cuisine and occasion assignments.
 * The restaurant-level assignment is then rebuilt as the union over the
 * restaurant's live branches, so Discovery's cuisine/occasion filters and the
 * deployed app keep reading the restaurant tables unchanged.
 */
@Injectable()
export class SetBranchCategoriesUseCase {
  constructor(
    private readonly branchAccess: BranchAccessService,
    private readonly categoriesReader: BranchCategoriesReader,
    @Inject(BRANCH_CATEGORY_REPOSITORY)
    private readonly branchCategoryRepository: BranchCategoryRepository,
    @Inject(CUISINE_CATEGORY_REPOSITORY)
    private readonly cuisineCategoryRepository: CuisineCategoryRepository,
    @Inject(OCCASION_CATEGORY_REPOSITORY)
    private readonly occasionCategoryRepository: OccasionCategoryRepository,
    @Inject(RESTAURANT_CUISINE_CATEGORY_REPOSITORY)
    private readonly restaurantCuisineCategoryRepository: RestaurantCuisineCategoryRepository,
    @Inject(RESTAURANT_OCCASION_CATEGORY_REPOSITORY)
    private readonly restaurantOccasionCategoryRepository: RestaurantOccasionCategoryRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: SetBranchCategoriesCommand): Promise<BranchCategoriesResult> {
    const { branch } = await this.branchAccess.resolve(command.restaurantId, command.branchId);
    const restaurantId = RestaurantId.create(command.restaurantId);

    const cuisineIds = Array.from(new Set(command.cuisineCategoryIds));
    const occasionIds = Array.from(new Set(command.occasionCategoryIds));
    const [cuisines, occasions] = await Promise.all([
      this.cuisineCategoryRepository.findByIds(cuisineIds),
      this.occasionCategoryRepository.findByIds(occasionIds),
    ]);
    if (cuisines.filter((category) => category.isActive).length !== cuisineIds.length) {
      throw new UnknownCuisineCategoryException();
    }
    if (occasions.filter((category) => category.isActive).length !== occasionIds.length) {
      throw new UnknownOccasionCategoryException();
    }

    const now = this.clock.now();
    await this.branchCategoryRepository.replaceCategoryIds(
      branch.branchId,
      'cuisine',
      cuisineIds.map((categoryId) => ({ id: this.idGenerator.generate(), categoryId })),
      now,
    );
    await this.branchCategoryRepository.replaceCategoryIds(
      branch.branchId,
      'occasion',
      occasionIds.map((categoryId) => ({ id: this.idGenerator.generate(), categoryId })),
      now,
    );
    await this.syncRestaurantUnion(restaurantId, now);

    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'branch.categories.updated',
      targetType: 'Branch',
      targetId: branch.branchId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    return this.categoriesReader.read(branch.branchId);
  }

  private async syncRestaurantUnion(restaurantId: RestaurantId, now: Date): Promise<void> {
    const [cuisineUnion, occasionUnion] = await Promise.all([
      this.branchCategoryRepository.findCategoryIdsOfLiveBranches(restaurantId, 'cuisine'),
      this.branchCategoryRepository.findCategoryIdsOfLiveBranches(restaurantId, 'occasion'),
    ]);
    await this.restaurantCuisineCategoryRepository.replaceAllForRestaurant(
      restaurantId,
      cuisineUnion.map((cuisineCategoryId) =>
        RestaurantCuisineCategory.create({
          id: this.idGenerator.generate(),
          restaurantId: restaurantId.value,
          cuisineCategoryId,
          createdAt: now,
        }),
      ),
    );
    await this.restaurantOccasionCategoryRepository.replaceAllForRestaurant(
      restaurantId,
      occasionUnion.map((occasionCategoryId) =>
        RestaurantOccasionCategory.create({
          id: this.idGenerator.generate(),
          restaurantId: restaurantId.value,
          occasionCategoryId,
          createdAt: now,
        }),
      ),
    );
  }
}
