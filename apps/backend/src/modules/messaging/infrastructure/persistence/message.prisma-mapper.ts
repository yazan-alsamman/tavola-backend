import { Message as PrismaMessage } from '@prisma/client';
import { Message as MessageEntity } from '../../domain/entities/message.entity';
import { MessageSenderType, MessageType } from '../../domain/enums/messaging.enums';

export class MessagePrismaMapper {
  static toDomain(row: PrismaMessage): MessageEntity {
    return MessageEntity.reconstitute({
      id: row.id,
      conversationId: row.conversationId,
      senderType: row.senderType as MessageSenderType,
      senderUserId: row.senderUserId,
      senderEmployeeId: row.senderEmployeeId,
      body: row.body,
      messageType: row.messageType as MessageType,
      attachmentFileId: row.attachmentFileId,
      anonymizedAt: row.anonymizedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toPersistence(message: MessageEntity): {
    id: string;
    conversationId: string;
    senderType: MessageSenderType;
    senderUserId: string | null;
    senderEmployeeId: string | null;
    body: string;
    messageType: MessageType;
    attachmentFileId: string | null;
    anonymizedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } {
    const props = message.toProps();
    return {
      id: props.id,
      conversationId: props.conversationId,
      senderType: props.senderType,
      senderUserId: props.senderUserId,
      senderEmployeeId: props.senderEmployeeId,
      body: props.body,
      messageType: props.messageType,
      attachmentFileId: props.attachmentFileId,
      anonymizedAt: props.anonymizedAt,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    };
  }
}
