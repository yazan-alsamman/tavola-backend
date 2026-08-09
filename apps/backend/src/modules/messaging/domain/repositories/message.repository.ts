import { Message } from '../entities/message.entity';
import { ConversationId, UserId } from '@shared/domain/value-objects/identifiers.vo';

export interface MessageCursor {
  createdAt: Date;
  id: string;
}

export interface MessagePage {
  items: Message[];
  hasMore: boolean;
}

/**
 * `Message` is a child entity of the `Conversation` aggregate, persisted
 * through its own repository - mirroring `Reservation`/`ReservationHistory`'s
 * own multi-repository shape for one aggregate, not an embedded array.
 */
export interface MessageRepository {
  create(message: Message): Promise<void>;

  /**
   * DECISIONS.md D13 - cursor (keyset) pagination on `(createdAt, id)`,
   * newest first. `after: null` returns the first page. `hasMore` reflects
   * whether a further page exists beyond the returned `items` (the
   * repository fetches one extra row internally to determine this, never
   * returning more than `limit` items).
   */
  findManyByConversationId(
    conversationId: ConversationId,
    after: MessageCursor | null,
    limit: number,
  ): Promise<MessagePage>;

  /**
   * Phase 20.X (ADR-014 execution) - `AnonymizeUserAccountUseCase`. Bulk
   * write matching `Message.anonymize()`'s own field-level transform
   * (`body -> '[removed]'`, `anonymizedAt` set) for every message this
   * user authored that isn't already anonymized - the entity method
   * itself was doc-commented "no erasure job exists yet" since it was
   * added; this is that job, applied in bulk rather than one entity
   * round-trip per row. Never touches messages authored by anyone else in
   * the same conversation. Idempotent: re-running only matches rows still
   * missing `anonymizedAt`.
   */
  anonymizeAllBySenderUserId(userId: UserId, at: Date): Promise<void>;
}

export const MESSAGE_REPOSITORY = Symbol('MESSAGE_REPOSITORY');
