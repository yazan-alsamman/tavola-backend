import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { ConversationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { MessageReadEvent } from '../../domain/events/messaging.events';
import {
  ConversationParticipantRepository,
  CONVERSATION_PARTICIPANT_REPOSITORY,
} from '../../domain/repositories/conversation-participant.repository';
import { ConversationAccessService } from '../services/conversation-access.service';
import { ConversationParticipantResolverService } from '../services/conversation-participant-resolver.service';
import { MarkConversationReadCommand } from '../dto/mark-conversation-read.command';
import { MarkConversationReadResult } from '../dto/mark-conversation-read.result';

/** `POST /conversations/:id/read` - Shared. */
@Injectable()
export class MarkConversationReadUseCase {
  constructor(
    @Inject(CONVERSATION_PARTICIPANT_REPOSITORY)
    private readonly participantRepository: ConversationParticipantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    private readonly conversationAccess: ConversationAccessService,
    private readonly participantResolver: ConversationParticipantResolverService,
  ) {}

  async execute(command: MarkConversationReadCommand): Promise<MarkConversationReadResult> {
    const conversationId = ConversationId.create(command.conversationId);
    const { conversation, isCustomer } = await this.conversationAccess.loadAuthorized(
      conversationId,
      command.actor,
    );

    const participant = isCustomer
      ? await this.participantResolver.resolveCustomer(
          conversationId,
          UserId.create(command.actor.userId),
        )
      : await this.participantResolver.resolveStaff(conversationId, command.actor);

    const now = this.clock.now();
    const read = participant.markRead(now);
    await this.participantRepository.update(read);

    await this.eventPublisher.publish(
      new MessageReadEvent(
        this.idGenerator.generate(),
        {
          conversationId: conversation.conversationId.value,
          restaurantId: conversation.restaurantId.value,
          participantId: read.participantId.value,
          lastReadAt: now.toISOString(),
          correlationId: command.correlationId,
        },
        now,
        command.correlationId,
      ),
    );

    return {
      conversationId: conversation.conversationId.value,
      participantId: read.participantId.value,
      lastReadAt: now,
    };
  }
}
