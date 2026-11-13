import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { BranchRepository, BRANCH_REPOSITORY } from '../../domain/repositories/branch.repository';
import { BranchUpdatedEvent } from '../../domain/events/branch.events';
import { toBranchResult } from '../mappers/branch-result.mapper';
import { BranchAccessService } from '../services/branch-access.service';
import { UpdateBranchDetailsCommand } from '../dto/branch-categories.command';
import { BranchResult } from '../dto/branch.result';

/**
 * ADR-051: sets the branch's own name and description (null falls back to
 * the restaurant's). Publishes the same BranchUpdatedEvent as the address
 * update, since both change what customers see for the branch.
 */
@Injectable()
export class UpdateBranchDetailsUseCase {
  constructor(
    private readonly branchAccess: BranchAccessService,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: UpdateBranchDetailsCommand): Promise<BranchResult> {
    const { restaurant, branch: existing } = await this.branchAccess.resolve(
      command.restaurantId,
      command.branchId,
    );
    const now = this.clock.now();
    const branch = existing.updateDetails(
      { name: normalize(command.name), description: normalize(command.description) },
      now,
    );
    await this.branchRepository.save(branch);

    await this.eventPublisher.publish(
      new BranchUpdatedEvent(
        this.idGenerator.generate(),
        {
          branchId: branch.branchId.value,
          restaurantId: restaurant.restaurantId.value,
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

/** An empty or blank value means "use the restaurant's", stored as null. */
function normalize(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
