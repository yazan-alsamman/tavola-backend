import { randomUUID } from 'crypto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  AuthenticatedEmployeeActor,
  AuthenticatedUserActor,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import {
  ConversationId,
  EmployeeId,
  RestaurantId,
  UserId,
} from '@shared/domain/value-objects/identifiers.vo';
import { InMemoryConversationRepository } from '../../../../../test/messaging/support/in-memory-conversation.repository';
import { InMemoryConversationParticipantRepository } from '../../../../../test/messaging/support/in-memory-conversation-participant.repository';
import { Conversation } from '../../domain/entities/conversation.entity';
import { ConversationParticipant } from '../../domain/entities/conversation-participant.entity';
import { ConversationStatus } from '../../domain/enums/messaging.enums';
import { MessageReadEvent } from '../../domain/events/messaging.events';
import { ConversationNotFoundException } from '../../domain/exceptions/conversation-not-found.exception';
import { ConversationAccessService } from '../services/conversation-access.service';
import { ConversationParticipantResolverService } from '../services/conversation-participant-resolver.service';
import { MarkConversationReadUseCase } from './mark-conversation-read.use-case';

const conversationId = '11111111-1111-4111-8111-111111111111';
const restaurantId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const customerUserId = '44444444-4444-4444-8444-444444444444';
const employeeId = '55555555-5555-4555-8555-555555555555';

function customerActor(overrides: Partial<AuthenticatedUserActor> = {}): AuthenticatedUserActor {
  return {
    actorType: AccessTokenActorType.User,
    userId: customerUserId,
    sessionId: 's1',
    sessionVersion: 1,
    tokenFamilyId: 'f1',
    ...overrides,
  };
}

function employeeActor(
  overrides: Partial<AuthenticatedEmployeeActor> = {},
): AuthenticatedEmployeeActor {
  return {
    actorType: AccessTokenActorType.Employee,
    userId: 'employee-user-1',
    sessionId: 's1',
    sessionVersion: 1,
    tokenFamilyId: 'f1',
    employeeId,
    organizationId: 'org-1',
    restaurantId,
    branchIds: [],
    permissions: ['conversations:manage'],
    permissionsVersion: 1,
    ...overrides,
  };
}

async function build(now: Date) {
  const conversationParticipantRepository = new InMemoryConversationParticipantRepository();
  const conversationRepository = new InMemoryConversationRepository(
    conversationParticipantRepository,
  );

  const conversation = Conversation.reconstitute({
    id: conversationId,
    restaurantId,
    branchId,
    reservationId: null,
    subject: null,
    status: ConversationStatus.Open,
    lastMessageAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await conversationRepository.create(conversation);
  await conversationParticipantRepository.create(
    ConversationParticipant.createCustomer({
      id: randomUUID(),
      conversationId,
      userId: customerUserId,
      now,
    }),
  );

  const restaurantRepository = {
    findById: async (id: RestaurantId) => ({
      organizationId: { value: 'org-1' },
      restaurantId: id,
    }),
  };
  const conversationAccess = new ConversationAccessService(
    conversationRepository,
    conversationParticipantRepository,
    restaurantRepository as never,
  );
  const clock = { now: () => now };
  const participantResolver = new ConversationParticipantResolverService(
    conversationParticipantRepository,
    clock as never,
    { generate: () => randomUUID() } as never,
  );

  const events: MessageReadEvent[] = [];
  const eventPublisher = {
    publish: jest.fn(async (e: MessageReadEvent) => {
      events.push(e);
    }),
    publishAll: jest.fn(),
  };

  const useCase = new MarkConversationReadUseCase(
    conversationParticipantRepository,
    clock as never,
    { generate: () => randomUUID() } as never,
    eventPublisher as never,
    conversationAccess,
    participantResolver,
  );

  return { useCase, conversationParticipantRepository, events };
}

describe('MarkConversationReadUseCase', () => {
  it('the Customer participant marks their own participant row read', async () => {
    const now = new Date('2026-07-30T10:00:00.000Z');
    const { useCase, events } = await build(now);

    const result = await useCase.execute({ actor: customerActor(), conversationId });

    expect(result.conversationId).toBe(conversationId);
    expect(result.lastReadAt).toEqual(now);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.lastReadAt).toBe(now.toISOString());
  });

  it('lazily creates a Staff participant row for an Employee marking read for the first time (D2)', async () => {
    const now = new Date('2026-07-30T10:00:00.000Z');
    const { useCase, conversationParticipantRepository } = await build(now);

    const result = await useCase.execute({ actor: employeeActor(), conversationId });

    const participant = await conversationParticipantRepository.findByConversationAndEmployee(
      ConversationId.create(conversationId),
      EmployeeId.create(employeeId),
    );
    expect(participant?.lastReadAt).toEqual(now);
    expect(result.participantId).toBe(participant?.participantId.value);
  });

  it('is idempotent: marking read twice re-uses the same participant row rather than duplicating it', async () => {
    const now = new Date('2026-07-30T10:00:00.000Z');
    const { useCase, conversationParticipantRepository } = await build(now);

    const first = await useCase.execute({ actor: customerActor(), conversationId });
    const second = await useCase.execute({ actor: customerActor(), conversationId });

    expect(second.participantId).toBe(first.participantId);
    const participant = await conversationParticipantRepository.findByConversationAndUser(
      ConversationId.create(conversationId),
      UserId.create(customerUserId),
    );
    expect(participant?.lastReadAt).toEqual(now);
  });

  it('denies a Customer who is not a participant of the conversation (IDOR-safe, D14)', async () => {
    const now = new Date('2026-07-30T10:00:00.000Z');
    const { useCase } = await build(now);

    await expect(
      useCase.execute({
        actor: customerActor({ userId: '99999999-9999-4999-8999-999999999999' }),
        conversationId,
      }),
    ).rejects.toThrow(ConversationNotFoundException);
  });

  it('denies an Employee scoped to a different restaurant (IDOR-safe, D14)', async () => {
    const now = new Date('2026-07-30T10:00:00.000Z');
    const { useCase } = await build(now);

    await expect(
      useCase.execute({
        actor: employeeActor({ restaurantId: '66666666-6666-4666-8666-666666666666' }),
        conversationId,
      }),
    ).rejects.toThrow(ConversationNotFoundException);
  });
});
