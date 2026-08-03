import { Conversation } from '../entities/conversation.entity';
import {
  BranchId,
  ConversationId,
  RestaurantId,
  UserId,
} from '@shared/domain/value-objects/identifiers.vo';

export interface ConversationCursor {
  updatedAt: Date;
  id: string;
}

export interface ConversationPage {
  items: Conversation[];
  hasMore: boolean;
}

/**
 * Tenant-owned TRANSITIVELY via `restaurantId -> Restaurant.organizationId`
 * (ADR-030) - no tenant filter here; every use case resolves the parent
 * `Restaurant` via the already-tenant-scoped `RestaurantRepository` first
 * (see this module's `assertActorCanManageConversation`, mirroring
 * `CreateBranchUseCase`'s own documented gate).
 */
export interface ConversationRepository {
  findById(id: ConversationId): Promise<Conversation | null>;

  create(conversation: Conversation): Promise<void>;

  update(conversation: Conversation): Promise<void>;

  /**
   * `GET /conversations` (Customer). Matches via the Customer's own
   * `ConversationParticipant` row (`userId` match) - never a direct
   * `Conversation` column. DECISIONS.md D11: excludes `status = Archived`
   * unless `includeArchived` is true. Cursor pagination on `(updatedAt, id)`
   * descending (D13).
   */
  findManyForCustomer(
    userId: UserId,
    includeArchived: boolean,
    after: ConversationCursor | null,
    limit: number,
  ): Promise<ConversationPage>;

  /**
   * `GET /restaurants/:restaurantId/conversations` (Staff). `restrictToBranchIds:
   * null` means no branch restriction (OrganizationMember, or an Employee
   * with no branch assignments configured); a non-null array restricts to an
   * Employee's assigned branches, including restaurant-level conversations
   * (`branchId: null`) which are always visible to any authorized Staff
   * actor for the restaurant regardless of branch restriction.
   */
  findManyForRestaurant(
    restaurantId: RestaurantId,
    restrictToBranchIds: BranchId[] | null,
    after: ConversationCursor | null,
    limit: number,
  ): Promise<ConversationPage>;
}

export const CONVERSATION_REPOSITORY = Symbol('CONVERSATION_REPOSITORY');
