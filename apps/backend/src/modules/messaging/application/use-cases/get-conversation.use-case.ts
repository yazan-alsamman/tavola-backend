import { Injectable } from '@nestjs/common';
import { ConversationId } from '@shared/domain/value-objects/identifiers.vo';
import { toConversationResult } from '../mappers/conversation-result.mapper';
import { ConversationAccessService } from '../services/conversation-access.service';
import { GetConversationCommand } from '../dto/get-conversation.command';
import { ConversationResult } from '../dto/conversation.result';

/** `GET /conversations/:id` - Shared (Customer or Restaurant-side). */
@Injectable()
export class GetConversationUseCase {
  constructor(private readonly conversationAccess: ConversationAccessService) {}

  async execute(command: GetConversationCommand): Promise<ConversationResult> {
    const { conversation } = await this.conversationAccess.loadAuthorized(
      ConversationId.create(command.conversationId),
      command.actor,
    );
    return toConversationResult(conversation);
  }
}
