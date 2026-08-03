import { randomUUID } from 'crypto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  AuthenticatedEmployeeActor,
  AuthenticatedOrganizationMemberActor,
  AuthenticatedUserActor,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { ConversationId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { InMemoryConversationRepository } from '../../../../../test/messaging/support/in-memory-conversation.repository';
import { InMemoryConversationParticipantRepository } from '../../../../../test/messaging/support/in-memory-conversation-participant.repository';
import { Conversation } from '../../domain/entities/conversation.entity';
import { ConversationParticipant } from '../../domain/entities/conversation-participant.entity';
import { ConversationStatus } from '../../domain/enums/messaging.enums';
import { ConversationClosedEvent } from '../../domain/events/messaging.events';
import { ConversationAccessService } from '../services/conversation-access.service';
import { CloseConversationUseCase } from './close-conversation.use-case';

const now = new Date('2026-07-30T10:00:00.000Z');
const conversationId = '11111111-1111-4111-8111-111111111111';
const restaurantId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const customerUserId = '44444444-4444-4444-8444-444444444444';

function customerActor(): AuthenticatedUserActor {
  return {
    actorType: AccessTokenActorType.User,
    userId: customerUserId,
    sessionId: 's1',
    sessionVersion: 1,
    tokenFamilyId: 'f1',
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
    employeeId: 'employee-1',
    organizationId: 'org-1',
    restaurantId,
    branchIds: [],
    permissions: ['conversations:manage'],
    permissionsVersion: 1,
    ...overrides,
  };
}

function orgMemberActor(): AuthenticatedOrganizationMemberActor {
  return {
    actorType: AccessTokenActorType.OrganizationMember,
    userId: 'org-member-1',
    sessionId: 's1',
    sessionVersion: 1,
    tokenFamilyId: 'f1',
    organizationId: 'org-1',
    orgRole: OrganizationMemberRole.Owner,
    permissionsVersion: 1,
  };
}

async function build() {
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

  const events: ConversationClosedEvent[] = [];
  const eventPublisher = {
    publish: jest.fn(async (e: ConversationClosedEvent) => {
      events.push(e);
    }),
    publishAll: jest.fn(),
  };

  const useCase = new CloseConversationUseCase(
    conversationRepository,
    { now: () => now } as never,
    { generate: () => randomUUID() } as never,
    eventPublisher as never,
    conversationAccess,
  );

  return { useCase, conversationRepository, events };
}

describe('CloseConversationUseCase (DECISIONS.md D5, actor-branched)', () => {
  it('a Restaurant-side actor (Employee) closes the conversation for both sides (status: Closed)', async () => {
    const { useCase, events } = await build();

    const result = await useCase.execute({ actor: employeeActor(), conversationId });

    expect(result.status).toBe(ConversationStatus.Closed);
    expect(events[0]?.payload.status).toBe(ConversationStatus.Closed);
    expect(events[0]?.payload.closedBy).toBe('Restaurant');
  });

  it('an OrganizationMember Owner also closes it as Restaurant-side', async () => {
    const { useCase } = await build();
    const result = await useCase.execute({ actor: orgMemberActor(), conversationId });
    expect(result.status).toBe(ConversationStatus.Closed);
  });

  it('the Customer participant archives it for themselves only (status: Archived)', async () => {
    const { useCase, events } = await build();

    const result = await useCase.execute({ actor: customerActor(), conversationId });

    expect(result.status).toBe(ConversationStatus.Archived);
    expect(events[0]?.payload.status).toBe(ConversationStatus.Archived);
    expect(events[0]?.payload.closedBy).toBe('Customer');
  });

  it('persists the new status via the repository', async () => {
    const { useCase, conversationRepository } = await build();
    await useCase.execute({ actor: customerActor(), conversationId });

    const reloaded = await conversationRepository.findById(ConversationId.create(conversationId));
    expect(reloaded?.status).toBe(ConversationStatus.Archived);
  });
});
