import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { ConversationId } from '@shared/domain/value-objects/identifiers.vo';
import { ConversationStatus } from '../../domain/enums/messaging.enums';
import { ConversationClosedEvent } from '../../domain/events/messaging.events';
import {
  ConversationRepository,
  CONVERSATION_REPOSITORY,
} from '../../domain/repositories/conversation.repository';
import { ConversationAccessService } from '../services/conversation-access.service';
import { toConversationResult } from '../mappers/conversation-result.mapper';
import { CloseConversationCommand } from '../dto/close-conversation.command';
import { ConversationResult } from '../dto/conversation.result';

/**
 * `POST /conversations/:id/close` - Shared, actor-branched (DECISIONS.md
 * D5): a Restaurant-side actor closes the conversation for both sides
 * (`status: Closed`); the Customer participant archives it for themselves
 * only (`status: Archived`). Either auto-reopens on the next `MessageSent`
 * (`Conversation.recordMessageSent`).
 */
@Injectable()
export class CloseConversationUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversationRepository: ConversationRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    private readonly conversationAccess: ConversationAccessService,
  ) {}

  async execute(command: CloseConversationCommand): Promise<ConversationResult> {
    const conversationId = ConversationId.create(command.conversationId);
    const { conversation, isCustomer } = await this.conversationAccess.loadAuthorized(
      conversationId,
      command.actor,
    );

    const now = this.clock.now();
    const updated = isCustomer ? conversation.archive(now) : conversation.close(now);

    await this.conversationRepository.update(updated);

    await this.eventPublisher.publish(
      new ConversationClosedEvent(
        this.idGenerator.generate(),
        {
          conversationId: conversationId.value,
          restaurantId: conversation.restaurantId.value,
          status: updated.status as ConversationStatus.Closed | ConversationStatus.Archived,
          closedBy: isCustomer ? 'Customer' : 'Restaurant',
          correlationId: command.correlationId,
        },
        now,
        command.correlationId,
      ),
    );

    return toConversationResult(updated);
  }
}
