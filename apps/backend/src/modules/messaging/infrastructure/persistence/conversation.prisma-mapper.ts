import { Conversation as PrismaConversation } from '@prisma/client';
import { Conversation as ConversationEntity } from '../../domain/entities/conversation.entity';
import { ConversationStatus } from '../../domain/enums/messaging.enums';

export class ConversationPrismaMapper {
  static toDomain(row: PrismaConversation): ConversationEntity {
    return ConversationEntity.reconstitute({
      id: row.id,
      restaurantId: row.restaurantId,
      branchId: row.branchId,
      reservationId: row.reservationId,
      subject: row.subject,
      status: row.status as ConversationStatus,
      lastMessageAt: row.lastMessageAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toPersistence(conversation: ConversationEntity): {
    id: string;
    restaurantId: string;
    branchId: string | null;
    reservationId: string | null;
    subject: string | null;
    status: ConversationStatus;
    lastMessageAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } {
    const props = conversation.toProps();
    return {
      id: props.id,
      restaurantId: props.restaurantId,
      branchId: props.branchId,
      reservationId: props.reservationId,
      subject: props.subject,
      status: props.status,
      lastMessageAt: props.lastMessageAt,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    };
  }
}
