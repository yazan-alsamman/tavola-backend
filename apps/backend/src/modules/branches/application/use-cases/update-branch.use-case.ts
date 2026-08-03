import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchRepository, BRANCH_REPOSITORY } from '../../domain/repositories/branch.repository';
import { BranchNotFoundException } from '../../domain/exceptions/branch-not-found.exception';
import { BranchUpdatedEvent } from '../../domain/events/branch.events';
import { toBranchResult } from '../mappers/branch-result.mapper';
import { UpdateBranchCommand } from '../dto/update-branch.command';
import { BranchResult } from '../dto/branch.result';

@Injectable()
export class UpdateBranchUseCase {
  constructor(
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: UpdateBranchCommand): Promise<BranchResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate - see CreateBranchUseCase's own comment.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const existing = await this.branchRepository.findByIdAndRestaurantId(
      BranchId.create(command.branchId),
      restaurantId,
    );
    if (existing === null) {
      throw new BranchNotFoundException();
    }

    const now = this.clock.now();
    const branch = existing.updateProfile(
      {
        city: command.city,
        district: command.district,
        address: command.address,
        latitude: command.latitude,
        longitude: command.longitude,
        countryCode: command.countryCode,
        currency: command.currency,
        timezone: command.timezone,
        phone: command.phone,
      },
      now,
    );

    await this.branchRepository.save(branch);

    await this.eventPublisher.publish(
      new BranchUpdatedEvent(
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
