import { Conversation } from '../../domain/entities/conversation.entity';
import { ConversationResult } from '../dto/conversation.result';

export function toConversationResult(conversation: Conversation): ConversationResult {
  return {
    conversationId: conversation.conversationId.value,
    restaurantId: conversation.restaurantId.value,
    branchId: conversation.branchId?.value ?? null,
    reservationId: conversation.reservationId?.value ?? null,
    subject: conversation.subject,
    status: conversation.status,
    lastMessageAt: conversation.lastMessageAt,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}
