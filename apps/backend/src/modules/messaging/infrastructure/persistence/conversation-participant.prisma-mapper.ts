import { ConversationParticipant as PrismaConversationParticipant } from '@prisma/client';
import { ConversationParticipant as ConversationParticipantEntity } from '../../domain/entities/conversation-participant.entity';
import { ConversationParticipantRole } from '../../domain/enums/messaging.enums';

export class ConversationParticipantPrismaMapper {
  static toDomain(row: PrismaConversationParticipant): ConversationParticipantEntity {
    return ConversationParticipantEntity.reconstitute({
      id: row.id,
      conversationId: row.conversationId,
      userId: row.userId,
      employeeId: row.employeeId,
      role: row.role as ConversationParticipantRole,
      lastReadAt: row.lastReadAt,
      joinedAt: row.joinedAt,
      leftAt: row.leftAt,
    });
  }

  static toPersistence(participant: ConversationParticipantEntity): {
    id: string;
    conversationId: string;
    userId: string | null;
    employeeId: string | null;
    role: ConversationParticipantRole;
    lastReadAt: Date | null;
    joinedAt: Date;
    leftAt: Date | null;
  } {
    const props = participant.toProps();
    return {
      id: props.id,
      conversationId: props.conversationId,
      userId: props.userId,
      employeeId: props.employeeId,
      role: props.role,
      lastReadAt: props.lastReadAt,
      joinedAt: props.joinedAt,
      leftAt: props.leftAt,
    };
  }
}
