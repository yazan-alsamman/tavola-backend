import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { BranchId, FloorPlanId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CLOCK,
  ID_GENERATOR,
  EVENT_PUBLISHER,
} from '@modules/authentication/domain/tokens/authentication.tokens';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { Table } from '../../domain/entities/table.entity';
import { TableStatus } from '../../domain/enums/table.enums';
import { TableRepository, TABLE_REPOSITORY } from '../../domain/repositories/table.repository';
import {
  FloorPlanRepository,
  FLOOR_PLAN_REPOSITORY,
} from '../../domain/repositories/floor-plan.repository';
import { FloorPlanNotFoundException } from '../../domain/exceptions/floor-plan-not-found.exception';
import { TableNumberAlreadyExistsException } from '../../domain/exceptions/table-number-already-exists.exception';
import { TableCreatedEvent } from '../../domain/events/table.events';
import { toTableResult } from '../mappers/table-result.mapper';
import { CreateTableCommand } from '../dto/create-table.command';
import { TableResult } from '../dto/table.result';

@Injectable()
export class CreateTableUseCase {
  constructor(
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(FLOOR_PLAN_REPOSITORY) private readonly floorPlanRepository: FloorPlanRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: CreateTableCommand): Promise<TableResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate - see CreateFloorPlanUseCase's own comment.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const branchId = BranchId.create(command.branchId);
    const branch = await this.branchRepository.findByIdAndRestaurantId(branchId, restaurantId);
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    const floorPlanId = FloorPlanId.create(command.floorPlanId);
    const floorPlan = await this.floorPlanRepository.findByIdAndBranchId(floorPlanId, branchId);
    if (floorPlan === null) {
      throw new FloorPlanNotFoundException();
    }

    if (await this.tableRepository.existsByBranchIdAndTableNumber(branchId, command.tableNumber)) {
      throw new TableNumberAlreadyExistsException(command.tableNumber);
    }

    const now = this.clock.now();
    const table = Table.create({
      id: this.idGenerator.generate(),
      branchId: branchId.value,
      floorPlanId: floorPlanId.value,
      tableNumber: command.tableNumber,
      capacity: command.capacity,
      floor: command.floor,
      positionX: command.positionX,
      positionY: command.positionY,
      width: command.width,
      height: command.height,
      rotation: command.rotation,
      shape: command.shape,
      layer: command.layer,
      indoor: command.indoor,
      vip: command.vip,
      smoking: command.smoking,
      // Phase 6.1 architecture decision (TASKS.md decision #7): always
      // Available. No Phase 6.1 endpoint accepts or transitions status.
      status: TableStatus.Available,
      // Phase 6 (Merge/Split Tables, ADR-026): a freshly created table is
      // never merged - Table.create() also enforces this independently.
      mergeGroupId: null,
      isMergePrimary: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    await this.tableRepository.save(table);

    await this.eventPublisher.publish(
      new TableCreatedEvent(
        this.idGenerator.generate(),
        {
          tableId: table.tableId.value,
          branchId: branchId.value,
          floorPlanId: floorPlanId.value,
          organizationId: restaurant.organizationId.value,
          actorId: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );

    return toTableResult(table);
  }
}
