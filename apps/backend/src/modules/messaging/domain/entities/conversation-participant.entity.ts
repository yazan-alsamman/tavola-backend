import { Entity } from '@shared/domain/base/entity.base';
import {
  ConversationId,
  ConversationParticipantId,
  EmployeeId,
  UserId,
} from '@shared/domain/value-objects/identifiers.vo';
import { ConversationParticipantRole } from '../enums/messaging.enums';
import { InvalidConversationException } from '../exceptions/invalid-conversation.exception';

export interface ConversationParticipantProps {
  id: string;
  conversationId: string;
  userId: string | null;
  employeeId: string | null;
  role: ConversationParticipantRole;
  lastReadAt: Date | null;
  joinedAt: Date;
  leftAt: Date | null;
}

/**
 * DECISIONS.md D2 - per-individual, lazily created on first interaction
 * (send or explicit read). A `Customer` row always carries `userId` (their
 * own `User.id`). A `Staff` row carries `employeeId` when the actor is an
 * Employee, or `userId` (the OrganizationMember's own `User.id`) when the
 * actor is an OrganizationMember - there is no `Employee` row for an
 * OrganizationMember. `Message.senderType` is what disambiguates a bare
 * `userId` between the Customer and OrganizationMember cases; this entity
 * alone cannot.
 */
export class ConversationParticipant extends Entity<ConversationParticipantProps> {
  private constructor(props: ConversationParticipantProps) {
    super(props);
  }

  static createCustomer(props: {
    id: string;
    conversationId: string;
    userId: string;
    now: Date;
  }): ConversationParticipant {
    return new ConversationParticipant({
      id: props.id,
      conversationId: props.conversationId,
      userId: props.userId,
      employeeId: null,
      role: ConversationParticipantRole.Customer,
      lastReadAt: null,
      joinedAt: props.now,
      leftAt: null,
    });
  }

  /**
   * `actorEmployeeId` is set for an Employee actor; `actorUserId` is set
   * (instead) for an OrganizationMember actor - exactly one, never both,
   * mirroring `resolveMessagingActorId`'s own dual resolution.
   */
  static createStaff(props: {
    id: string;
    conversationId: string;
    actorUserId: string | null;
    actorEmployeeId: string | null;
    now: Date;
  }): ConversationParticipant {
    const hasUser = props.actorUserId !== null;
    const hasEmployee = props.actorEmployeeId !== null;
    if (hasUser === hasEmployee) {
      throw new InvalidConversationException(
        'A Staff participant must reference exactly one of an OrganizationMember userId or an Employee employeeId.',
      );
    }
    return new ConversationParticipant({
      id: props.id,
      conversationId: props.conversationId,
      userId: props.actorUserId,
      employeeId: props.actorEmployeeId,
      role: ConversationParticipantRole.Staff,
      lastReadAt: null,
      joinedAt: props.now,
      leftAt: null,
    });
  }

  static reconstitute(props: ConversationParticipantProps): ConversationParticipant {
    return new ConversationParticipant({ ...props });
  }

  get participantId(): ConversationParticipantId {
    return ConversationParticipantId.create(this.props.id);
  }

  get conversationId(): ConversationId {
    return ConversationId.create(this.props.conversationId);
  }

  get userId(): UserId | null {
    return this.props.userId ? UserId.create(this.props.userId) : null;
  }

  get employeeId(): EmployeeId | null {
    return this.props.employeeId ? EmployeeId.create(this.props.employeeId) : null;
  }

  get role(): ConversationParticipantRole {
    return this.props.role;
  }

  get lastReadAt(): Date | null {
    return this.props.lastReadAt ? new Date(this.props.lastReadAt.getTime()) : null;
  }

  get joinedAt(): Date {
    return new Date(this.props.joinedAt.getTime());
  }

  markRead(at: Date): ConversationParticipant {
    return ConversationParticipant.reconstitute({
      ...this.props,
      lastReadAt: at,
    });
  }

  toProps(): Readonly<ConversationParticipantProps> {
    return { ...this.props };
  }
}
