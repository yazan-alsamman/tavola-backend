import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import {
  PlatformAdminRepository,
  PLATFORM_ADMIN_REPOSITORY,
} from '../../domain/repositories/platform-admin.repository';
import { PlatformAdminNotFoundException } from '../../domain/exceptions/platform-admin-not-found.exception';
import { PlatformAdminAccountReactivatedEvent } from '../../domain/events/platform-admin.events';
import { ReactivatePlatformAdminCommand } from '../dto/platform-admin-account.dto';

@Injectable()
export class ReactivatePlatformAdminUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_REPOSITORY)
    private readonly platformAdminRepository: PlatformAdminRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: ReactivatePlatformAdminCommand): Promise<void> {
    const existing = await this.platformAdminRepository.findById(command.platformAdminId);
    if (existing === null) {
      throw new PlatformAdminNotFoundException();
    }

    await this.platformAdminRepository.reactivate(command.platformAdminId);
    const now = this.clock.now();

    await this.eventPublisher.publish(
      new PlatformAdminAccountReactivatedEvent(
        this.idGenerator.generate(),
        { platformAdminId: command.platformAdminId, role: existing.role, actorId: command.actorId },
        now,
        command.correlationId,
      ),
    );
  }
}
