import { Entity } from '@shared/domain/base/entity.base';
import {
  BranchId,
  ConversationId,
  ReservationId,
  RestaurantId,
} from '@shared/domain/value-objects/identifiers.vo';
import { ConversationStatus } from '../enums/messaging.enums';

export interface ConversationProps {
  id: string;
  restaurantId: string;
  branchId: string | null;
  reservationId: string | null;
  subject: string | null;
  status: ConversationStatus;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Conversation Aggregate Root (DOMAIN_MODEL.md "Messaging Aggregate").
 * Tenant-owned TRANSITIVELY via `restaurantId -> Restaurant.organizationId`
 * (ADR-030) - carries no `organizationId` of its own. `ConversationParticipant`
 * and `Message` are child entities persisted through their own repositories
 * (mirroring `Reservation`/`ReservationGuest`/`ReservationHistory`'s own
 * three-repository shape), not embedded arrays on this aggregate.
 *
 * DECISIONS.md D5: `Open -> {Closed, Archived}`, and `{Closed, Archived} ->
 * Open` automatically whenever a new Message is sent (`reopen()`) - closing/
 * archiving is a convenience signal, not a hard lock. `close()` is called by
 * a Restaurant-side actor; `archive()` is called by the Customer participant
 * only (enforced by the calling use case, not this entity, since actor
 * identity is not part of Conversation's own state).
 */
export class Conversation extends Entity<ConversationProps> {
  private constructor(props: ConversationProps) {
    super(props);
  }

  static start(props: {
    id: string;
    restaurantId: string;
    branchId: string | null;
    reservationId: string | null;
    subject: string | null;
    now: Date;
  }): Conversation {
    return new Conversation({
      id: props.id,
      restaurantId: props.restaurantId,
      branchId: props.branchId,
      reservationId: props.reservationId,
      subject: props.subject,
      status: ConversationStatus.Open,
      lastMessageAt: null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: ConversationProps): Conversation {
    return new Conversation({ ...props });
  }

  get conversationId(): ConversationId {
    return ConversationId.create(this.props.id);
  }

  get restaurantId(): RestaurantId {
    return RestaurantId.create(this.props.restaurantId);
  }

  get branchId(): BranchId | null {
    return this.props.branchId ? BranchId.create(this.props.branchId) : null;
  }

  get reservationId(): ReservationId | null {
    return this.props.reservationId ? ReservationId.create(this.props.reservationId) : null;
  }

  get subject(): string | null {
    return this.props.subject;
  }

  get status(): ConversationStatus {
    return this.props.status;
  }

  get lastMessageAt(): Date | null {
    return this.props.lastMessageAt ? new Date(this.props.lastMessageAt.getTime()) : null;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  /** Restaurant-side actor only (enforced by the calling use case). */
  close(at: Date): Conversation {
    return Conversation.reconstitute({
      ...this.props,
      status: ConversationStatus.Closed,
      updatedAt: at,
    });
  }

  /** Customer participant only (enforced by the calling use case). */
  archive(at: Date): Conversation {
    return Conversation.reconstitute({
      ...this.props,
      status: ConversationStatus.Archived,
      updatedAt: at,
    });
  }

  /**
   * DECISIONS.md D5 auto-reopen - called by `SendMessageUseCase` whenever
   * `status !== Open`, from either actor side. Also stamps `lastMessageAt`,
   * since every call site of this recording happens exactly once per
   * successfully sent Message.
   */
  recordMessageSent(at: Date): Conversation {
    return Conversation.reconstitute({
      ...this.props,
      status: ConversationStatus.Open,
      lastMessageAt: at,
      updatedAt: at,
    });
  }

  toProps(): Readonly<ConversationProps> {
    return { ...this.props };
  }
}
