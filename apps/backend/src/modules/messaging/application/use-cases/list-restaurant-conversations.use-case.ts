import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessagingConfig } from '@config/messaging.config';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { ConversationNotFoundException } from '../../domain/exceptions/conversation-not-found.exception';
import { toConversationResult } from '../mappers/conversation-result.mapper';
import { encodeMessagingCursor, decodeMessagingCursor } from '../services/messaging-cursor.util';
import { assertActorCanManageConversation } from '../services/assert-actor-can-manage-conversation';
import {
  ConversationRepository,
  CONVERSATION_REPOSITORY,
} from '../../domain/repositories/conversation.repository';
import { ListRestaurantConversationsCommand } from '../dto/list-restaurant-conversations.command';
import { ConversationListResult } from '../dto/conversation.result';

/**
 * `GET /restaurants/:restaurantId/conversations` - Staff only (D15). An
 * Employee with a non-empty `branchIds` sees only conversations restricted
 * to their assigned branches plus every restaurant-wide (`branchId: null`)
 * conversation (`ConversationRepository.findManyForRestaurant`'s own
 * contract); an Employee with an empty `branchIds` array and any
 * OrganizationMember see every conversation for the restaurant.
 */
@Injectable()
export class ListRestaurantConversationsUseCase {
  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversationRepository: ConversationRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    private readonly configService: ConfigService,
  ) {}

  async execute(command: ListRestaurantConversationsCommand): Promise<ConversationListResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const restrictToBranchIds = await this.authorizeAndResolveBranchRestriction(
      command,
      restaurantId,
    );

    const config = this.configService.get<MessagingConfig>('messaging', { infer: true });
    if (!config) {
      throw new Error('Messaging configuration is not loaded.');
    }
    const limit = clampLimit(command.limit, config.cursorPagination);
    const after = command.cursor ? decodeMessagingCursor(command.cursor) : null;

    const page = await this.conversationRepository.findManyForRestaurant(
      restaurantId,
      restrictToBranchIds,
      after ? { updatedAt: after.sortValue, id: after.id } : null,
      limit,
    );

    const items = page.items.map(toConversationResult);
    const last = items[items.length - 1];
    const nextCursor =
      page.hasMore && last ? encodeMessagingCursor(last.updatedAt, last.conversationId) : null;

    return { items, nextCursor };
  }

  private async authorizeAndResolveBranchRestriction(
    command: ListRestaurantConversationsCommand,
    restaurantId: RestaurantId,
  ): Promise<BranchId[] | null> {
    if (command.actor.actorType === AccessTokenActorType.Employee) {
      if (command.actor.restaurantId !== restaurantId.value) {
        throw new ConversationNotFoundException();
      }
      assertActorCanManageConversation(command.actor, command.actor.organizationId, null);
      return command.actor.branchIds.length > 0
        ? command.actor.branchIds.map((id) => BranchId.create(id))
        : null;
    }

    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new ConversationNotFoundException();
    }
    assertActorCanManageConversation(command.actor, restaurant.organizationId.value, null);
    return null;
  }
}

function clampLimit(
  requested: number | undefined,
  config: MessagingConfig['cursorPagination'],
): number {
  const value = requested ?? config.defaultLimit;
  return Math.min(Math.max(value, 1), config.maxLimit);
}
