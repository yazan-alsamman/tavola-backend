import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagingConfig } from '@config/messaging.config';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { toConversationResult } from '../mappers/conversation-result.mapper';
import { encodeMessagingCursor, decodeMessagingCursor } from '../services/messaging-cursor.util';
import {
  ConversationRepository,
  CONVERSATION_REPOSITORY,
} from '../../domain/repositories/conversation.repository';
import { ListCustomerConversationsCommand } from '../dto/list-customer-conversations.command';
import { ConversationListResult } from '../dto/conversation.result';

/** `GET /conversations` - Customer only. Cursor pagination (D13) on `(updatedAt, id)`; excludes `Archived` by default (D11). */
@Injectable()
export class ListCustomerConversationsUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversationRepository: ConversationRepository,
    private readonly configService: ConfigService,
  ) {}

  async execute(command: ListCustomerConversationsCommand): Promise<ConversationListResult> {
    const config = this.configService.get<MessagingConfig>('messaging', { infer: true });
    if (!config) {
      throw new Error('Messaging configuration is not loaded.');
    }
    const limit = clampLimit(command.limit, config.cursorPagination);
    const after = command.cursor ? decodeMessagingCursor(command.cursor) : null;

    const page = await this.conversationRepository.findManyForCustomer(
      UserId.create(command.actor.userId),
      command.includeArchived ?? false,
      after ? { updatedAt: after.sortValue, id: after.id } : null,
      limit,
    );

    const items = page.items.map(toConversationResult);
    const last = items[items.length - 1];
    const nextCursor =
      page.hasMore && last ? encodeMessagingCursor(last.updatedAt, last.conversationId) : null;

    return { items, nextCursor };
  }
}

function clampLimit(
  requested: number | undefined,
  config: MessagingConfig['cursorPagination'],
): number {
  const value = requested ?? config.defaultLimit;
  return Math.min(Math.max(value, 1), config.maxLimit);
}
