import { Message } from '../../domain/entities/message.entity';
import { MessageResult } from '../dto/message.result';

export function toMessageResult(message: Message): MessageResult {
  return {
    messageId: message.messageId.value,
    conversationId: message.conversationId.value,
    senderType: message.senderType,
    senderUserId: message.senderUserId?.value ?? null,
    senderEmployeeId: message.senderEmployeeId?.value ?? null,
    body: message.body,
    messageType: message.messageType,
    attachmentFileId: message.attachmentFileId?.value ?? null,
    anonymizedAt: message.anonymizedAt,
    createdAt: message.createdAt,
  };
}
