import {
  ConversationResult,
  ConversationListResult,
} from '../../application/dto/conversation.result';
import { MessageResult, MessageListResult } from '../../application/dto/message.result';
import { MarkConversationReadResult } from '../../application/dto/mark-conversation-read.result';
import { ConversationResponseDto } from '../dto/conversation.response.dto';
import { ConversationListResponseDto } from '../dto/conversation-list.response.dto';
import { MessageResponseDto } from '../dto/message.response.dto';
import { MessageListResponseDto } from '../dto/message-list.response.dto';
import { MarkConversationReadResponseDto } from '../dto/mark-conversation-read.response.dto';

export function toConversationResponse(result: ConversationResult): ConversationResponseDto {
  return {
    conversationId: result.conversationId,
    restaurantId: result.restaurantId,
    branchId: result.branchId,
    reservationId: result.reservationId,
    subject: result.subject,
    status: result.status,
    lastMessageAt: result.lastMessageAt ? result.lastMessageAt.toISOString() : null,
    createdAt: result.createdAt.toISOString(),
    updatedAt: result.updatedAt.toISOString(),
  };
}

export function toConversationListResponse(
  result: ConversationListResult,
): ConversationListResponseDto {
  return {
    items: result.items.map(toConversationResponse),
    nextCursor: result.nextCursor,
  };
}

export function toMessageResponse(result: MessageResult): MessageResponseDto {
  return {
    messageId: result.messageId,
    conversationId: result.conversationId,
    senderType: result.senderType,
    senderUserId: result.senderUserId,
    senderEmployeeId: result.senderEmployeeId,
    body: result.body,
    messageType: result.messageType,
    attachmentFileId: result.attachmentFileId,
    anonymizedAt: result.anonymizedAt ? result.anonymizedAt.toISOString() : null,
    createdAt: result.createdAt.toISOString(),
  };
}

export function toMessageListResponse(result: MessageListResult): MessageListResponseDto {
  return {
    items: result.items.map(toMessageResponse),
    nextCursor: result.nextCursor,
  };
}

export function toMarkConversationReadResponse(
  result: MarkConversationReadResult,
): MarkConversationReadResponseDto {
  return {
    conversationId: result.conversationId,
    participantId: result.participantId,
    lastReadAt: result.lastReadAt.toISOString(),
  };
}
