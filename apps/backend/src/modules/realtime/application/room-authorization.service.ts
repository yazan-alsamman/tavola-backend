import { Inject, Injectable } from '@nestjs/common';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '@modules/reservations/domain/repositories/reservation.repository';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import {
  BranchId,
  ConversationId,
  OrganizationId,
  ReservationId,
  RestaurantId,
  UserId,
} from '@shared/domain/value-objects/identifiers.vo';
import { InvalidUuidException } from '@shared/domain/value-objects/uuid-id.vo';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { resolveCorrelationId } from '@infrastructure/logging/correlation-id.util';
import {
  ConversationRepository,
  CONVERSATION_REPOSITORY,
} from '@modules/messaging/domain/repositories/conversation.repository';
import {
  ConversationParticipantRepository,
  CONVERSATION_PARTICIPANT_REPOSITORY,
} from '@modules/messaging/domain/repositories/conversation-participant.repository';
import { ConversationPolicy } from '@modules/messaging/domain/services/conversation-policy';
import { assertActorCanManageConversation } from '@modules/messaging/application/services/assert-actor-can-manage-conversation';
import { RoomType, buildCanonicalRoom } from './room';

/**
 * Phase 8 §8/§13/§14/§16/§19 — the actor -> room authorization matrix,
 * frozen exactly as TASKS.md's own table. Returns the SERVER-built canonical
 * room string on success, `null` on any denial - callers must never
 * distinguish "does not exist" from "not authorized" in the client-facing
 * ack (§12's IDOR-safe collapse, the same pattern
 * `assertActorCanModifyReservation` already establishes for REST).
 */
@Injectable()
export class RoomAuthorizationService {
  constructor(
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversationRepository: ConversationRepository,
    @Inject(CONVERSATION_PARTICIPANT_REPOSITORY)
    private readonly conversationParticipantRepository: ConversationParticipantRepository,
    private readonly tenantContextService: TenantContextService,
  ) {}

  async authorize(
    actor: AuthenticatedActor,
    roomType: RoomType,
    resourceId: string,
  ): Promise<string | null> {
    try {
      switch (roomType) {
        case RoomType.Organization:
          return this.authorizeOrganization(actor, resourceId);
        case RoomType.Restaurant:
          return await this.authorizeRestaurant(actor, resourceId);
        case RoomType.Branch:
          return await this.authorizeBranch(actor, resourceId);
        case RoomType.Reservation:
          return await this.authorizeReservation(actor, resourceId);
        case RoomType.Conversation:
          return await this.authorizeConversation(actor, resourceId);
      }
    } catch (error) {
      if (error instanceof InvalidUuidException) {
        return null;
      }
      throw error;
    }
  }

  private authorizeOrganization(actor: AuthenticatedActor, resourceId: string): string | null {
    // Malformed-id check for consistency with every other room type, even
    // though Organization only ever compares against the actor's own claim.
    const organizationId = OrganizationId.create(resourceId);

    if (actor.actorType !== AccessTokenActorType.OrganizationMember) {
      return null;
    }
    if (actor.organizationId !== organizationId.value) {
      return null;
    }
    return buildCanonicalRoom(RoomType.Organization, organizationId.value);
  }

  private async authorizeRestaurant(
    actor: AuthenticatedActor,
    resourceId: string,
  ): Promise<string | null> {
    const restaurantId = RestaurantId.create(resourceId);

    if (actor.actorType === AccessTokenActorType.User) {
      return null;
    }

    if (actor.actorType === AccessTokenActorType.Employee) {
      return actor.restaurantId === restaurantId.value
        ? buildCanonicalRoom(RoomType.Restaurant, restaurantId.value)
        : null;
    }

    // OrganizationMember: Restaurant is a DIRECT_TENANT_OWNED_MODEL, so
    // binding TenantContext to the actor's own organizationId makes the
    // Prisma extension itself enforce "same organization" - a cross-org
    // restaurantId resolves to null exactly like "does not exist" (TENANCY.md).
    const restaurant = await this.tenantContextService.runAsync(
      {
        organizationId: actor.organizationId,
        userId: actor.userId,
        actorType: actor.actorType,
        correlationId: resolveCorrelationId(undefined),
      },
      () => this.restaurantRepository.findById(restaurantId),
    );
    return restaurant !== null ? buildCanonicalRoom(RoomType.Restaurant, restaurantId.value) : null;
  }

  private async authorizeBranch(
    actor: AuthenticatedActor,
    resourceId: string,
  ): Promise<string | null> {
    const branchId = BranchId.create(resourceId);

    if (actor.actorType === AccessTokenActorType.User) {
      return null;
    }

    const branch = await this.branchRepository.findById(branchId);
    if (branch === null) {
      return null;
    }

    if (actor.actorType === AccessTokenActorType.Employee) {
      if (branch.restaurantId.value !== actor.restaurantId) {
        return null;
      }
      if (actor.branchIds.length > 0 && !actor.branchIds.includes(branchId.value)) {
        return null;
      }
      return buildCanonicalRoom(RoomType.Branch, branchId.value);
    }

    // OrganizationMember: Branch -> Restaurant -> Organization walk, same
    // tenant-scoped restaurant lookup as authorizeRestaurant above.
    const restaurant = await this.tenantContextService.runAsync(
      {
        organizationId: actor.organizationId,
        userId: actor.userId,
        actorType: actor.actorType,
        correlationId: resolveCorrelationId(undefined),
      },
      () => this.restaurantRepository.findById(branch.restaurantId),
    );
    return restaurant !== null ? buildCanonicalRoom(RoomType.Branch, branchId.value) : null;
  }

  private async authorizeReservation(
    actor: AuthenticatedActor,
    resourceId: string,
  ): Promise<string | null> {
    const reservationId = ReservationId.create(resourceId);
    const reservation = await this.reservationRepository.findById(reservationId);
    if (reservation === null) {
      return null;
    }

    if (actor.actorType === AccessTokenActorType.User) {
      // Guest-backed reservations (userId === null - Phone/WalkIn/guest-backed
      // WaitlistConversion) are never Customer-subscribable (§13) - no guest
      // WebSocket authentication exists in Phase 8.
      if (reservation.userId === null || reservation.userId.value !== actor.userId) {
        return null;
      }
      return buildCanonicalRoom(RoomType.Reservation, reservationId.value);
    }

    if (actor.actorType === AccessTokenActorType.Employee) {
      if (reservation.restaurantId.value !== actor.restaurantId) {
        return null;
      }
      if (actor.branchIds.length > 0 && !actor.branchIds.includes(reservation.branchId.value)) {
        return null;
      }
      return buildCanonicalRoom(RoomType.Reservation, reservationId.value);
    }

    // OrganizationMember: Reservation -> Restaurant -> Organization.
    const restaurant = await this.tenantContextService.runAsync(
      {
        organizationId: actor.organizationId,
        userId: actor.userId,
        actorType: actor.actorType,
        correlationId: resolveCorrelationId(undefined),
      },
      () => this.restaurantRepository.findById(reservation.restaurantId),
    );
    return restaurant !== null
      ? buildCanonicalRoom(RoomType.Reservation, reservationId.value)
      : null;
  }

  /**
   * Phase 15.6 (Messaging, DECISIONS.md D9) — a `User` actor must be the
   * conversation's `Customer` participant (`ConversationPolicy`); an
   * `Employee`/`OrganizationMember` actor must pass the same Dual Actor
   * check (D15) `SendMessage`/`GetConversation` already use
   * (`assertActorCanManageConversation`), wrapped here since this method's
   * contract returns `null` on denial rather than throwing - never a
   * distinguishing error, exactly like every other room type above.
   */
  private async authorizeConversation(
    actor: AuthenticatedActor,
    resourceId: string,
  ): Promise<string | null> {
    const conversationId = ConversationId.create(resourceId);
    const conversation = await this.conversationRepository.findById(conversationId);
    if (conversation === null) {
      return null;
    }

    if (actor.actorType === AccessTokenActorType.User) {
      const userId = UserId.create(actor.userId);
      const participant = await this.conversationParticipantRepository.findByConversationAndUser(
        conversationId,
        userId,
      );
      return ConversationPolicy.isCustomerParticipant(participant, userId)
        ? buildCanonicalRoom(RoomType.Conversation, conversationId.value)
        : null;
    }

    try {
      if (actor.actorType === AccessTokenActorType.Employee) {
        if (actor.restaurantId !== conversation.restaurantId.value) {
          return null;
        }
        assertActorCanManageConversation(actor, actor.organizationId, conversation.branchId);
      } else {
        const restaurant = await this.tenantContextService.runAsync(
          {
            organizationId: actor.organizationId,
            userId: actor.userId,
            actorType: actor.actorType,
            correlationId: resolveCorrelationId(undefined),
          },
          () => this.restaurantRepository.findById(conversation.restaurantId),
        );
        if (restaurant === null) {
          return null;
        }
        assertActorCanManageConversation(
          actor,
          restaurant.organizationId.value,
          conversation.branchId,
        );
      }
      return buildCanonicalRoom(RoomType.Conversation, conversationId.value);
    } catch {
      return null;
    }
  }
}
