import { ConversationParticipant } from '../entities/conversation-participant.entity';
import { ConversationId, EmployeeId, UserId } from '@shared/domain/value-objects/identifiers.vo';

/**
 * `ConversationParticipant` rows are created lazily (DECISIONS.md D2) - the
 * first send or explicit read for a given actor creates their row if one
 * does not already exist. There is deliberately no `findByConversationId`
 * returning every participant at once - each use case resolves only the
 * one participant row relevant to the current actor.
 */
export interface ConversationParticipantRepository {
  findByConversationAndUser(
    conversationId: ConversationId,
    userId: UserId,
  ): Promise<ConversationParticipant | null>;

  findByConversationAndEmployee(
    conversationId: ConversationId,
    employeeId: EmployeeId,
  ): Promise<ConversationParticipant | null>;

  /**
   * DECISIONS.md D6 - `NotificationDispatcher`'s sole way to resolve a
   * `MessageSent` notification's recipient: it only has `conversationId`,
   * never the Customer's own `userId`, so this is the one legitimate
   * "resolve a participant without already knowing its key" query. The
   * Customer participant always exists from `StartConversation` onward
   * (created eagerly, unlike the lazily-created Staff participant), so this
   * should never return `null` for a real conversation - a `null` is
   * treated as a silent no-op by the caller, never an error.
   */
  findCustomerParticipant(conversationId: ConversationId): Promise<ConversationParticipant | null>;

  create(participant: ConversationParticipant): Promise<void>;

  update(participant: ConversationParticipant): Promise<void>;
}

export const CONVERSATION_PARTICIPANT_REPOSITORY = Symbol('CONVERSATION_PARTICIPANT_REPOSITORY');
