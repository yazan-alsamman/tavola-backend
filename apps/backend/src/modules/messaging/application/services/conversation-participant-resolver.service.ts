import { Inject, Injectable } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { ConversationId, EmployeeId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ConversationParticipant } from '../../domain/entities/conversation-participant.entity';
import {
  ConversationParticipantRepository,
  CONVERSATION_PARTICIPANT_REPOSITORY,
} from '../../domain/repositories/conversation-participant.repository';

/**
 * DECISIONS.md D2 - `ConversationParticipant` rows are created lazily on
 * first interaction. Used by every use case that needs "the current actor's
 * own participant row" (`SendMessage`, `MarkConversationRead`,
 * `authorizeConversation` for realtime) - a Customer actor always resolves
 * to a `userId` lookup; a Restaurant-side actor (already authorized by
 * `assertActorCanManageConversation`) resolves to an `employeeId` lookup for
 * an `Employee`, or a `userId` lookup for an `OrganizationMember`.
 */
@Injectable()
export class ConversationParticipantResolverService {
  constructor(
    @Inject(CONVERSATION_PARTICIPANT_REPOSITORY)
    private readonly participantRepository: ConversationParticipantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async resolveCustomer(
    conversationId: ConversationId,
    userId: UserId,
  ): Promise<ConversationParticipant> {
    const existing = await this.participantRepository.findByConversationAndUser(
      conversationId,
      userId,
    );
    if (existing !== null) {
      return existing;
    }
    const created = ConversationParticipant.createCustomer({
      id: this.idGenerator.generate(),
      conversationId: conversationId.value,
      userId: userId.value,
      now: this.clock.now(),
    });
    await this.participantRepository.create(created);
    // A concurrent request may have won the (conversationId, userId) unique
    // race - PrismaConversationParticipantRepository.create swallows that
    // P2002 as a no-op, so re-fetch rather than trust the in-memory entity,
    // which may not be the row that actually persisted.
    return (
      (await this.participantRepository.findByConversationAndUser(conversationId, userId)) ??
      created
    );
  }

  /** `actor` must already be authorized (`assertActorCanManageConversation`) as Restaurant-side. */
  async resolveStaff(
    conversationId: ConversationId,
    actor: AuthenticatedActor,
  ): Promise<ConversationParticipant> {
    if (actor.actorType === AccessTokenActorType.Employee) {
      const employeeId = EmployeeId.create(actor.employeeId);
      const existing = await this.participantRepository.findByConversationAndEmployee(
        conversationId,
        employeeId,
      );
      if (existing !== null) {
        return existing;
      }
      const created = ConversationParticipant.createStaff({
        id: this.idGenerator.generate(),
        conversationId: conversationId.value,
        actorUserId: null,
        actorEmployeeId: actor.employeeId,
        now: this.clock.now(),
      });
      await this.participantRepository.create(created);
      return (
        (await this.participantRepository.findByConversationAndEmployee(
          conversationId,
          employeeId,
        )) ?? created
      );
    }

    const userId = UserId.create(actor.userId);
    const existing = await this.participantRepository.findByConversationAndUser(
      conversationId,
      userId,
    );
    if (existing !== null) {
      return existing;
    }
    const created = ConversationParticipant.createStaff({
      id: this.idGenerator.generate(),
      conversationId: conversationId.value,
      actorUserId: actor.userId,
      actorEmployeeId: null,
      now: this.clock.now(),
    });
    await this.participantRepository.create(created);
    return (
      (await this.participantRepository.findByConversationAndUser(conversationId, userId)) ??
      created
    );
  }
}
