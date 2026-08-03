import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ConversationParticipant } from '../entities/conversation-participant.entity';
import { ConversationParticipantRole } from '../enums/messaging.enums';

/**
 * DOMAIN_MODEL.md "Messaging Aggregate" Policies - the Customer-ownership
 * half of `ConversationPolicy` ("only participants... may read/send;
 * customers cannot access other customers' threads"). The Restaurant-side
 * half (Dual Actor: Employee branch+permission or OrganizationMember org
 * role) is resolved in the application layer by
 * `assertActorCanManageConversation` (DECISIONS.md D15), mirroring
 * `assertActorCanManageTables`/`assertEmployeeCanActOnReservation` - it
 * depends on JWT actor claims, which are not a domain-layer concept.
 */
export class ConversationPolicy {
  static isCustomerParticipant(
    participant: ConversationParticipant | null,
    userId: UserId,
  ): boolean {
    if (participant === null) {
      return false;
    }
    return (
      participant.role === ConversationParticipantRole.Customer &&
      participant.userId !== null &&
      participant.userId.equals(userId)
    );
  }
}
