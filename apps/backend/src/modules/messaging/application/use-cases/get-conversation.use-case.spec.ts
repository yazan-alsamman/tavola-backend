import { randomUUID } from 'crypto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  AuthenticatedEmployeeActor,
  AuthenticatedOrganizationMemberActor,
  AuthenticatedUserActor,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { InMemoryConversationRepository } from '../../../../../test/messaging/support/in-memory-conversation.repository';
import { InMemoryConversationParticipantRepository } from '../../../../../test/messaging/support/in-memory-conversation-participant.repository';
import { Conversation } from '../../domain/entities/conversation.entity';
import { ConversationParticipant } from '../../domain/entities/conversation-participant.entity';
import { ConversationStatus } from '../../domain/enums/messaging.enums';
import { ConversationNotFoundException } from '../../domain/exceptions/conversation-not-found.exception';
import { ConversationAccessService } from '../services/conversation-access.service';
import { GetConversationUseCase } from './get-conversation.use-case';

const now = new Date('2026-07-30T10:00:00.000Z');
const conversationId = '11111111-1111-4111-8111-111111111111';
const restaurantId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const customerUserId = '44444444-4444-4444-8444-444444444444';

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
    employeeId: 'employee-1',
    organizationId: 'org-1',
    restaurantId,
    branchIds: [],
    permissions: ['conversations:manage'],
    permissionsVersion: 1,
    ...overrides,
  };
}

function orgMemberActor(
  overrides: Partial<AuthenticatedOrganizationMemberActor> = {},
): AuthenticatedOrganizationMemberActor {
  return {
    actorType: AccessTokenActorType.OrganizationMember,
    userId: 'org-member-1',
    sessionId: 's1',
    sessionVersion: 1,
    tokenFamilyId: 'f1',
    organizationId: 'org-1',
    orgRole: OrganizationMemberRole.Owner,
    permissionsVersion: 1,
    ...overrides,
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
    subject: 'Table for 4',
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

  const useCase = new GetConversationUseCase(conversationAccess);

  return { useCase };
}

describe('GetConversationUseCase', () => {
  it('returns the conversation for the Customer participant', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({ actor: customerActor(), conversationId });

    expect(result.conversationId).toBe(conversationId);
    expect(result.subject).toBe('Table for 4');
    expect(result.status).toBe(ConversationStatus.Open);
  });

  it('returns the conversation for an authorized Employee (Restaurant-side)', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({ actor: employeeActor(), conversationId });

    expect(result.conversationId).toBe(conversationId);
  });

  it('returns the conversation for an authorized OrganizationMember Owner', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({ actor: orgMemberActor(), conversationId });

    expect(result.conversationId).toBe(conversationId);
  });

  it('denies a Customer who is not a participant of the conversation (IDOR-safe, D14)', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: customerActor({ userId: '99999999-9999-4999-8999-999999999999' }),
        conversationId,
      }),
    ).rejects.toThrow(ConversationNotFoundException);
  });

  it('denies an Employee scoped to a different restaurant (IDOR-safe, D14)', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: employeeActor({ restaurantId: '55555555-5555-4555-8555-555555555555' }),
        conversationId,
      }),
    ).rejects.toThrow(ConversationNotFoundException);
  });

  it('collapses an unknown conversationId to the same 404 (D14)', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: customerActor(),
        conversationId: '66666666-6666-4666-8666-666666666666',
      }),
    ).rejects.toThrow(ConversationNotFoundException);
  });
});
