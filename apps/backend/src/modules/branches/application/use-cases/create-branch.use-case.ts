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
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { Branch } from '../../domain/entities/branch.entity';
import { BranchRepository, BRANCH_REPOSITORY } from '../../domain/repositories/branch.repository';
import { BranchCreatedEvent } from '../../domain/events/branch.events';
import { toBranchResult } from '../mappers/branch-result.mapper';
import { CreateBranchCommand } from '../dto/create-branch.command';
import { BranchResult } from '../dto/branch.result';

@Injectable()
export class CreateBranchUseCase {
  constructor(
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
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

    await this.branchRepository.save(branch);

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
