import { ConversationParticipant } from '@modules/messaging/domain/entities/conversation-participant.entity';
import { ConversationParticipantRepository } from '@modules/messaging/domain/repositories/conversation-participant.repository';
import { ConversationParticipantRole } from '@modules/messaging/domain/enums/messaging.enums';
import { ConversationId, EmployeeId, UserId } from '@shared/domain/value-objects/identifiers.vo';

export class InMemoryConversationParticipantRepository implements ConversationParticipantRepository {
  private readonly rows = new Map<string, ConversationParticipant>();

  async findByConversationAndUser(
    conversationId: ConversationId,
    userId: UserId,
  ): Promise<ConversationParticipant | null> {
    return (
      [...this.rows.values()].find(
        (row) =>
          row.conversationId.value === conversationId.value && row.userId?.value === userId.value,
      ) ?? null
    );
  }

  async findByConversationAndEmployee(
    conversationId: ConversationId,
    employeeId: EmployeeId,
  ): Promise<ConversationParticipant | null> {
    return (
      [...this.rows.values()].find(
        (row) =>
          row.conversationId.value === conversationId.value &&
          row.employeeId?.value === employeeId.value,
      ) ?? null
    );
  }

  async findCustomerParticipant(
    conversationId: ConversationId,
  ): Promise<ConversationParticipant | null> {
    return (
      [...this.rows.values()].find(
        (row) =>
          row.conversationId.value === conversationId.value &&
          row.role === ConversationParticipantRole.Customer,
      ) ?? null
    );
  }

  async create(participant: ConversationParticipant): Promise<void> {
    this.rows.set(participant.participantId.value, participant);
  }

  async update(participant: ConversationParticipant): Promise<void> {
    this.rows.set(participant.participantId.value, participant);
  }

  isCustomerParticipant(conversationId: ConversationId, userId: UserId): boolean {
    return [...this.rows.values()].some(
      (row) =>
        row.conversationId.value === conversationId.value &&
        row.role === ConversationParticipantRole.Customer &&
        row.userId?.value === userId.value,
    );
  }
}
