import { ConversationStatus } from '../../domain/enums/messaging.enums';

export interface ConversationResult {
  conversationId: string;
  restaurantId: string;
  branchId: string | null;
  reservationId: string | null;
  subject: string | null;
  status: ConversationStatus;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationListResult {
  items: ConversationResult[];
  nextCursor: string | null;
}
