import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { ConversationId, RestaurantId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { Conversation } from '../../domain/entities/conversation.entity';
import { ConversationNotFoundException } from '../../domain/exceptions/conversation-not-found.exception';
import {
  ConversationRepository,
  CONVERSATION_REPOSITORY,
} from '../../domain/repositories/conversation.repository';
import {
  ConversationParticipantRepository,
  CONVERSATION_PARTICIPANT_REPOSITORY,
} from '../../domain/repositories/conversation-participant.repository';
import { ConversationPolicy } from '../../domain/services/conversation-policy';
import { assertActorCanManageConversation } from './assert-actor-can-manage-conversation';

export interface AuthorizedConversationAccess {
  conversation: Conversation;
  isCustomer: boolean;
}

/**
 * DECISIONS.md D14/D15/ADR-030 - the shared "load a Conversation and confirm
 * the current actor may access it" gate, reused by every use case that
 * operates on an EXISTING conversation (`GetConversation`, `SendMessage`,
 * `ListMessages`, `MarkConversationRead`, `CloseConversation`, and realtime's
 * `authorizeConversation`). Centralized so the IDOR-safe 404/403 split
 * (D14) and the Employee-vs-OrganizationMember tenant resolution (D1) are
 * implemented exactly once.
 */
@Injectable()
export class ConversationAccessService {
  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversationRepository: ConversationRepository,
    @Inject(CONVERSATION_PARTICIPANT_REPOSITORY)
    private readonly participantRepository: ConversationParticipantRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
  ) {}

  async loadAuthorized(
    conversationId: ConversationId,
    actor: AuthenticatedActor,
  ): Promise<AuthorizedConversationAccess> {
    const conversation = await this.conversationRepository.findById(conversationId);
    if (conversation === null) {
      throw new ConversationNotFoundException();
    }

    if (actor.actorType === AccessTokenActorType.User) {
      const participant = await this.participantRepository.findByConversationAndUser(
        conversationId,
        UserId.create(actor.userId),
      );
      if (!ConversationPolicy.isCustomerParticipant(participant, UserId.create(actor.userId))) {
        throw new ConversationNotFoundException();
      }
      return { conversation, isCustomer: true };
    }

    const organizationId = await this.resolveOrganizationId(actor, conversation.restaurantId);
    assertActorCanManageConversation(actor, organizationId, conversation.branchId);
    return { conversation, isCustomer: false };
  }

  private async resolveOrganizationId(
    actor: AuthenticatedActor,
    restaurantId: RestaurantId,
  ): Promise<string> {
    if (actor.actorType === AccessTokenActorType.Employee) {
      if (actor.restaurantId !== restaurantId.value) {
        throw new ConversationNotFoundException();
      }
      return actor.organizationId;
    }
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new ConversationNotFoundException();
    }
    return restaurant.organizationId.value;
  }
}
