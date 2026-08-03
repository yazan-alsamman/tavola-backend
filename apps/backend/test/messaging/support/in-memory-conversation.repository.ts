import { Conversation } from '@modules/messaging/domain/entities/conversation.entity';
import {
  ConversationCursor,
  ConversationPage,
  ConversationRepository,
} from '@modules/messaging/domain/repositories/conversation.repository';
import {
  BranchId,
  ConversationId,
  RestaurantId,
  UserId,
} from '@shared/domain/value-objects/identifiers.vo';
import { InMemoryConversationParticipantRepository } from './in-memory-conversation-participant.repository';

export class InMemoryConversationRepository implements ConversationRepository {
  private readonly rows = new Map<string, Conversation>();

  constructor(private readonly participantRepository?: InMemoryConversationParticipantRepository) {}

  async findById(id: ConversationId): Promise<Conversation | null> {
    return this.rows.get(id.value) ?? null;
  }

  async create(conversation: Conversation): Promise<void> {
    this.rows.set(conversation.conversationId.value, conversation);
  }

  async update(conversation: Conversation): Promise<void> {
    this.rows.set(conversation.conversationId.value, conversation);
  }

  async findManyForCustomer(
    userId: UserId,
    includeArchived: boolean,
    after: ConversationCursor | null,
    limit: number,
  ): Promise<ConversationPage> {
    const participantRepository = this.participantRepository;
    const matches = [...this.rows.values()].filter((conversation) => {
      if (!includeArchived && conversation.status === 'Archived') {
        return false;
      }
      if (!participantRepository) {
        return false;
      }
      return participantRepository.isCustomerParticipant(conversation.conversationId, userId);
    });
    return paginate(matches, after, limit);
  }

  async findManyForRestaurant(
    restaurantId: RestaurantId,
    restrictToBranchIds: BranchId[] | null,
    after: ConversationCursor | null,
    limit: number,
  ): Promise<ConversationPage> {
    const matches = [...this.rows.values()].filter((conversation) => {
      if (conversation.restaurantId.value !== restaurantId.value) {
        return false;
      }
      if (restrictToBranchIds === null) {
        return true;
      }
      if (conversation.branchId === null) {
        return true;
      }
      return restrictToBranchIds.some((id) => id.value === conversation.branchId!.value);
    });
    return paginate(matches, after, limit);
  }
}

function paginate(
  items: Conversation[],
  after: ConversationCursor | null,
  limit: number,
): ConversationPage {
  const sorted = [...items].sort((a, b) => {
    const diff = b.updatedAt.getTime() - a.updatedAt.getTime();
    return diff !== 0 ? diff : b.conversationId.value.localeCompare(a.conversationId.value);
  });
  const filtered = after
    ? sorted.filter((conversation) => {
        if (conversation.updatedAt.getTime() !== after.updatedAt.getTime()) {
          return conversation.updatedAt.getTime() < after.updatedAt.getTime();
        }
        return conversation.conversationId.value < after.id;
      })
    : sorted;
  const hasMore = filtered.length > limit;
  return { items: filtered.slice(0, limit), hasMore };
}
