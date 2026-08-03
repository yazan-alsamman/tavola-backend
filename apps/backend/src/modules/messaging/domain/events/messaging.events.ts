import { DomainEvent } from '@shared/domain/base/domain-event.base';
import { ConversationStatus, MessageSenderType, MessageType } from '../enums/messaging.enums';

export interface MessagingEventPayload {
  correlationId?: string;
}

/**
 * EVENTS.md "Messaging Events" - published by `StartConversationUseCase`.
 * `customerUserId` is always the Customer participant's `User.id` (only a
 * registered User may start a conversation, DECISIONS.md D2).
 */
export class ConversationStartedEvent extends DomainEvent {
  public readonly eventName = 'ConversationStarted';

  constructor(
    eventId: string,
    public readonly payload: MessagingEventPayload & {
      conversationId: string;
      restaurantId: string;
      branchId: string | null;
      customerUserId: string;
      reservationId: string | null;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * Published by `SendMessageUseCase` for every successfully persisted
 * Message, regardless of sender side - the realtime mapper (D9) fans this
 * out to `conversation:{id}` only, and the notification dispatcher (D6)
 * only acts on it when `senderType` is `Employee`/`OrganizationMember`.
 */
export class MessageSentEvent extends DomainEvent {
  public readonly eventName = 'MessageSent';

  constructor(
    eventId: string,
    public readonly payload: MessagingEventPayload & {
      conversationId: string;
      restaurantId: string;
      branchId: string | null;
      messageId: string;
      senderType: MessageSenderType;
      senderUserId: string | null;
      senderEmployeeId: string | null;
      body: string;
      messageType: MessageType;
      attachmentFileId: string | null;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/** Published by `MarkConversationReadUseCase`. */
export class MessageReadEvent extends DomainEvent {
  public readonly eventName = 'MessageRead';

  constructor(
    eventId: string,
    public readonly payload: MessagingEventPayload & {
      conversationId: string;
      restaurantId: string;
      participantId: string;
      lastReadAt: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * Published by `CloseConversationUseCase` for both the Restaurant-side
 * (`status: Closed`) and Customer (`status: Archived`) branches (D5) - one
 * event class, `closedBy` disambiguates which actor side acted.
 */
export class ConversationClosedEvent extends DomainEvent {
  public readonly eventName = 'ConversationClosed';

  constructor(
    eventId: string,
    public readonly payload: MessagingEventPayload & {
      conversationId: string;
      restaurantId: string;
      status: ConversationStatus.Closed | ConversationStatus.Archived;
      closedBy: 'Restaurant' | 'Customer';
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}
