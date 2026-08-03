import { Entity } from '@shared/domain/base/entity.base';
import {
  ConversationId,
  EmployeeId,
  FileId,
  MessageId,
  UserId,
} from '@shared/domain/value-objects/identifiers.vo';
import { MessageSenderType, MessageType } from '../enums/messaging.enums';
import { InvalidMessageException } from '../exceptions/invalid-message.exception';

const MAX_BODY_LENGTH = 4000;

export interface MessageProps {
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
}

/**
 * DECISIONS.md D3 - `senderType` disambiguates a populated `senderUserId`
 * between a Customer and an OrganizationMember (both reference `User`); the
 * database CHECK constraint on `sender_user_id`/`sender_employee_id` alone
 * cannot make that distinction, so it is validated here instead.
 */
export class Message extends Entity<MessageProps> {
  private constructor(props: MessageProps) {
    super(props);
  }

  static create(props: {
    id: string;
    conversationId: string;
    senderType: MessageSenderType;
    senderUserId: string | null;
    senderEmployeeId: string | null;
    body: string;
    messageType?: MessageType;
    attachmentFileId?: string | null;
    now: Date;
  }): Message {
    validateSender(props.senderType, props.senderUserId, props.senderEmployeeId);
    validateBody(props.body, props.messageType ?? MessageType.Text);

    return new Message({
      id: props.id,
      conversationId: props.conversationId,
      senderType: props.senderType,
      senderUserId: props.senderUserId,
      senderEmployeeId: props.senderEmployeeId,
      body: props.body,
      messageType: props.messageType ?? MessageType.Text,
      attachmentFileId: props.attachmentFileId ?? null,
      anonymizedAt: null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: MessageProps): Message {
    return new Message({ ...props });
  }

  get messageId(): MessageId {
    return MessageId.create(this.props.id);
  }

  get conversationId(): ConversationId {
    return ConversationId.create(this.props.conversationId);
  }

  get senderType(): MessageSenderType {
    return this.props.senderType;
  }

  get senderUserId(): UserId | null {
    return this.props.senderUserId ? UserId.create(this.props.senderUserId) : null;
  }

  get senderEmployeeId(): EmployeeId | null {
    return this.props.senderEmployeeId ? EmployeeId.create(this.props.senderEmployeeId) : null;
  }

  get body(): string {
    return this.props.body;
  }

  get messageType(): MessageType {
    return this.props.messageType;
  }

  get attachmentFileId(): FileId | null {
    return this.props.attachmentFileId ? FileId.create(this.props.attachmentFileId) : null;
  }

  get anonymizedAt(): Date | null {
    return this.props.anonymizedAt ? new Date(this.props.anonymizedAt.getTime()) : null;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  /** DECISIONS.md D10 (GDPR) - no erasure job exists yet; this is the write path a future one would use. */
  anonymize(at: Date): Message {
    return Message.reconstitute({
      ...this.props,
      body: '[removed]',
      anonymizedAt: at,
      updatedAt: at,
    });
  }

  toProps(): Readonly<MessageProps> {
    return { ...this.props };
  }
}

function validateSender(
  senderType: MessageSenderType,
  senderUserId: string | null,
  senderEmployeeId: string | null,
): void {
  const hasUser = senderUserId !== null;
  const hasEmployee = senderEmployeeId !== null;

  if (senderType === MessageSenderType.System) {
    if (hasUser || hasEmployee) {
      throw new InvalidMessageException(
        'A System-sent message must not reference senderUserId or senderEmployeeId.',
      );
    }
    return;
  }

  if (hasUser === hasEmployee) {
    throw new InvalidMessageException(
      'A message must reference exactly one of senderUserId or senderEmployeeId, unless senderType is System.',
    );
  }

  if (senderType === MessageSenderType.Employee && !hasEmployee) {
    throw new InvalidMessageException('An Employee-sent message must set senderEmployeeId.');
  }

  if (
    (senderType === MessageSenderType.Customer ||
      senderType === MessageSenderType.OrganizationMember) &&
    !hasUser
  ) {
    throw new InvalidMessageException(
      'A Customer- or OrganizationMember-sent message must set senderUserId.',
    );
  }
}

function validateBody(body: string, messageType: MessageType): void {
  if (messageType !== MessageType.Text) {
    return;
  }
  if (body.trim().length === 0) {
    throw new InvalidMessageException('body must not be empty for a Text message.');
  }
  if (body.length > MAX_BODY_LENGTH) {
    throw new InvalidMessageException(`body must not exceed ${MAX_BODY_LENGTH} characters.`);
  }
}
