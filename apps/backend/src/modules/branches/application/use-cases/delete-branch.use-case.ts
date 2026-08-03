import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  FloorPlanRepository,
  FLOOR_PLAN_REPOSITORY,
} from '@modules/tables/domain/repositories/floor-plan.repository';
import {
  TableRepository,
  TABLE_REPOSITORY,
} from '@modules/tables/domain/repositories/table.repository';
import {
  RestaurantUsageRepository,
  RESTAURANT_USAGE_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-usage.repository';
import { BranchRepository, BRANCH_REPOSITORY } from '../../domain/repositories/branch.repository';
import { BranchNotFoundException } from '../../domain/exceptions/branch-not-found.exception';
import { BranchDeletedEvent } from '../../domain/events/branch.events';
import { DeleteBranchCommand } from '../dto/delete-branch.command';

@Injectable()
export class DeleteBranchUseCase {
  constructor(
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(FLOOR_PLAN_REPOSITORY) private readonly floorPlanRepository: FloorPlanRepository,
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(RESTAURANT_USAGE_REPOSITORY)
    private readonly restaurantUsageRepository: RestaurantUsageRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: DeleteBranchCommand): Promise<void> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate - see CreateBranchUseCase's own comment.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const branchId = BranchId.create(command.branchId);
    const existing = await this.branchRepository.findByIdAndRestaurantId(branchId, restaurantId);
    if (existing === null) {
      throw new BranchNotFoundException();
    }

    const now = this.clock.now();
    const branch = existing.softDelete(now);

    // Cascade (TASKS.md Phase 6.1 decisions #3/#6): FloorPlans and Tables are
    // both Branch Aggregate child entities, so soft-deleting a Branch must
    // soft-delete both alongside it, inside ONE transaction - partial
    // completion (e.g. Branch deleted but Tables/FloorPlans not) is
    // forbidden. Bulk repository calls, not per-row entity round trips,
    // matching BranchWorkingHoursRepository.replaceAllForBranch's own
    // precedent for multi-row Branch-child operations.
    await this.unitOfWork.execute(async () => {
      await this.branchRepository.save(branch);
      await this.tableRepository.softDeleteAllForBranch(branchId, now);
      await this.floorPlanRepository.softDeleteAllForBranch(branchId, now);
      // Phase 12 (Subscriptions, ADR-027 §11) - never below zero (repository-guarded).
      await this.restaurantUsageRepository.decrementBranchCount(restaurantId);
    });

    await this.eventPublisher.publish(
      new BranchDeletedEvent(
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
  }
}
