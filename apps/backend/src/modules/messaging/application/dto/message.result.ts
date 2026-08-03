import { MessageSenderType, MessageType } from '../../domain/enums/messaging.enums';

export interface MessageResult {
  messageId: string;
  conversationId: string;
  senderType: MessageSenderType;
  senderUserId: string | null;
  senderEmployeeId: string | null;
  body: string;
  messageType: MessageType;
  attachmentFileId: string | null;
  anonymizedAt: Date | null;
  createdAt: Date;
}

export interface MessageListResult {
  items: MessageResult[];
  nextCursor: string | null;
}
