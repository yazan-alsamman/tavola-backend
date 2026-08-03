import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagingConfig } from '@config/messaging.config';
import { ConversationId } from '@shared/domain/value-objects/identifiers.vo';
import { toMessageResult } from '../mappers/message-result.mapper';
import { encodeMessagingCursor, decodeMessagingCursor } from '../services/messaging-cursor.util';
import { ConversationAccessService } from '../services/conversation-access.service';
import {
  MessageRepository,
  MESSAGE_REPOSITORY,
} from '../../domain/repositories/message.repository';
import { ListMessagesCommand } from '../dto/list-messages.command';
import { MessageListResult } from '../dto/message.result';

/** `GET /conversations/:id/messages` - Shared. Cursor pagination (D13), default 50 / max 100. */
@Injectable()
export class ListMessagesUseCase {
  constructor(
    @Inject(MESSAGE_REPOSITORY) private readonly messageRepository: MessageRepository,
    private readonly conversationAccess: ConversationAccessService,
    private readonly configService: ConfigService,
  ) {}

  async execute(command: ListMessagesCommand): Promise<MessageListResult> {
    const conversationId = ConversationId.create(command.conversationId);
    await this.conversationAccess.loadAuthorized(conversationId, command.actor);

    const config = this.configService.get<MessagingConfig>('messaging', { infer: true });
    if (!config) {
      throw new Error('Messaging configuration is not loaded.');
    }
    const limit = clampLimit(command.limit, config.cursorPagination);
    const after = command.cursor ? decodeMessagingCursor(command.cursor) : null;

    const page = await this.messageRepository.findManyByConversationId(
      conversationId,
      after ? { createdAt: after.sortValue, id: after.id } : null,
      limit,
    );

    const items = page.items.map(toMessageResult);
    const last = items[items.length - 1];
    const nextCursor =
      page.hasMore && last ? encodeMessagingCursor(last.createdAt, last.messageId) : null;

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
