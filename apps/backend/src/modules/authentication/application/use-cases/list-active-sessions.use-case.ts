import { Injectable, Inject } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ClockPort } from '@shared/application/ports/clock.port';
import { DeviceSessionRepository } from '../../domain/repositories/authentication.repositories';
import { CLOCK, DEVICE_SESSION_REPOSITORY } from '../../domain/tokens/authentication.tokens';
import {
  ActiveSessionItem,
  ListActiveSessionsCommand,
  ListActiveSessionsResult,
} from '../dto/list-active-sessions.dto';

@Injectable()
export class ListActiveSessionsUseCase {
  constructor(
    @Inject(DEVICE_SESSION_REPOSITORY)
    private readonly deviceSessionRepository: DeviceSessionRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: ListActiveSessionsCommand): Promise<ListActiveSessionsResult> {
    const now = this.clock.now();
    const userId = UserId.create(command.actor.userId);
    const sessions = await this.deviceSessionRepository.findActiveByUserId(userId, now);

    const items: ActiveSessionItem[] = sessions.map((session) => {
      const props = session.toProps();
      return {
        sessionId: props.id,
        deviceName: props.deviceName,
        deviceType: props.deviceType,
        createdAt: props.createdAt,
        lastUsedAt: props.lastUsedAt,
        expiresAt: props.expiresAt,
        isCurrentSession: props.id === command.actor.sessionId,
        ipAddress: props.ipAddress,
      };
    });

    return { sessions: items };
  }
}
