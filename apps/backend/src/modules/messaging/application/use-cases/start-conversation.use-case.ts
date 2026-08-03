import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { USER_REPOSITORY } from '@modules/authentication/domain/tokens/authentication.tokens';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '@modules/reservations/domain/repositories/reservation.repository';
import {
  BranchId,
  ReservationId,
  RestaurantId,
  UserId,
} from '@shared/domain/value-objects/identifiers.vo';
import { Conversation } from '../../domain/entities/conversation.entity';
import { ConversationParticipant } from '../../domain/entities/conversation-participant.entity';
import { ConversationStartedEvent } from '../../domain/events/messaging.events';
import { ConversationNotFoundException } from '../../domain/exceptions/conversation-not-found.exception';
import { InvalidConversationException } from '../../domain/exceptions/invalid-conversation.exception';
import {
  ConversationRepository,
  CONVERSATION_REPOSITORY,
} from '../../domain/repositories/conversation.repository';
import {
  ConversationParticipantRepository,
  CONVERSATION_PARTICIPANT_REPOSITORY,
} from '../../domain/repositories/conversation-participant.repository';
import { assertActorCanManageConversation } from '../services/assert-actor-can-manage-conversation';
import { toConversationResult } from '../mappers/conversation-result.mapper';
import { StartConversationCommand } from '../dto/start-conversation.command';
import { ConversationResult } from '../dto/conversation.result';

/**
 * DECISIONS.md D1/ADR-030 - `restaurantId` is resolved/validated per actor
 * type exactly like `CreateReservationUseCase`'s own Branch gate: a Customer
 * actor has no tenant context, so `RestaurantRepository.existsPubliclyById`
 * (the same public-safe existence check Reviews already uses) stands in for
 * the tenant-scoped lookup; an `Employee` actor's `restaurantId` is compared
 * directly against the JWT claim (no repository round-trip); an
 * `OrganizationMember` actor requires the tenant-scoped
 * `RestaurantRepository.findById` (D15).
 */
@Injectable()
export class StartConversationUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversationRepository: ConversationRepository,
    @Inject(CONVERSATION_PARTICIPANT_REPOSITORY)
    private readonly participantRepository: ConversationParticipantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: StartConversationCommand): Promise<ConversationResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const branchId = command.branchId ? BranchId.create(command.branchId) : null;

    const customerUserId = await this.resolveCustomerUserId(command, restaurantId, branchId);

    let reservationId: string | null = null;
    if (command.reservationId) {
      const reservation = await this.reservationRepository.findById(
        ReservationId.create(command.reservationId),
      );
      if (reservation === null || reservation.restaurantId.value !== restaurantId.value) {
        throw new InvalidConversationException('reservationId does not belong to restaurantId.');
      }
      reservationId = command.reservationId;
    }

    const now = this.clock.now();
    const conversation = Conversation.start({
      id: this.idGenerator.generate(),
      restaurantId: restaurantId.value,
      branchId: branchId?.value ?? null,
      reservationId,
      subject: command.subject ?? null,
      now,
    });

    await this.unitOfWork.execute(async () => {
      await this.conversationRepository.create(conversation);
      const customerParticipant = ConversationParticipant.createCustomer({
        id: this.idGenerator.generate(),
        conversationId: conversation.conversationId.value,
        userId: customerUserId,
        now,
      });
      await this.participantRepository.create(customerParticipant);
    });

    await this.eventPublisher.publish(
      new ConversationStartedEvent(
        this.idGenerator.generate(),
        {
          conversationId: conversation.conversationId.value,
          restaurantId: restaurantId.value,
          branchId: branchId?.value ?? null,
          customerUserId,
          reservationId,
          correlationId: command.correlationId,
        },
        now,
        command.correlationId,
      ),
    );

    return toConversationResult(conversation);
  }

  private async resolveCustomerUserId(
    command: StartConversationCommand,
    restaurantId: RestaurantId,
    branchId: BranchId | null,
  ): Promise<string> {
    if (command.actor.actorType === AccessTokenActorType.User) {
      const exists = await this.restaurantRepository.existsPubliclyById(restaurantId);
      if (!exists) {
        throw new ConversationNotFoundException();
      }
      if (branchId !== null) {
        const branch = await this.branchRepository.findById(branchId);
        if (branch === null || branch.restaurantId.value !== restaurantId.value) {
          throw new InvalidConversationException('branchId does not belong to restaurantId.');
        }
      }
      return command.actor.userId;
    }

    if (!command.customerUserId) {
      throw new InvalidConversationException(
        'customerUserId is required when a Restaurant-side actor starts a conversation.',
      );
    }

    if (command.actor.actorType === AccessTokenActorType.Employee) {
      if (command.actor.restaurantId !== restaurantId.value) {
        throw new ConversationNotFoundException();
      }
      assertActorCanManageConversation(command.actor, command.actor.organizationId, branchId);
    } else {
      const restaurant = await this.restaurantRepository.findById(restaurantId);
      if (restaurant === null) {
        throw new ConversationNotFoundException();
      }
      assertActorCanManageConversation(command.actor, restaurant.organizationId.value, branchId);
    }

    if (branchId !== null) {
      const branch = await this.branchRepository.findByIdAndRestaurantId(branchId, restaurantId);
      if (branch === null) {
        throw new ConversationNotFoundException();
      }
    }

    const targetUser = await this.userRepository.findById(UserId.create(command.customerUserId));
    if (targetUser === null) {
      throw new InvalidConversationException('customerUserId does not reference an existing user.');
    }

    return command.customerUserId;
  }
}
