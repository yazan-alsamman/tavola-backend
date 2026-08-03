import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { MessagingConfig } from '@config/messaging.config';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  AuthenticatedEmployeeActor,
  AuthenticatedOrganizationMemberActor,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { InMemoryConversationRepository } from '../../../../../test/messaging/support/in-memory-conversation.repository';
import { InMemoryConversationParticipantRepository } from '../../../../../test/messaging/support/in-memory-conversation-participant.repository';
import { Conversation } from '../../domain/entities/conversation.entity';
import { ConversationStatus } from '../../domain/enums/messaging.enums';
import { ConversationNotFoundException } from '../../domain/exceptions/conversation-not-found.exception';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { ListRestaurantConversationsUseCase } from './list-restaurant-conversations.use-case';

const restaurantId = '22222222-2222-4222-8222-222222222222';
const branchIdA = '33333333-3333-4333-8333-333333333333';
const branchIdB = '77777777-7777-4777-8777-777777777777';

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

function fakeConfigService(): ConfigService {
  const config: MessagingConfig = {
    sendRateLimit: { max: 30, windowSeconds: 60 },
    cursorPagination: { defaultLimit: 50, maxLimit: 100 },
    idempotency: { ttlSeconds: 86400 },
  };
  return { get: () => config } as unknown as ConfigService;
}

async function seedConversation(
  conversationRepository: InMemoryConversationRepository,
  overrides: { branchId?: string | null } = {},
) {
  const conversation = Conversation.reconstitute({
    id: randomUUID(),
    restaurantId,
    branchId: overrides.branchId === undefined ? null : overrides.branchId,
    reservationId: null,
    subject: null,
    status: ConversationStatus.Open,
    lastMessageAt: null,
    createdAt: new Date('2026-07-30T10:00:00.000Z'),
    updatedAt: new Date('2026-07-30T10:00:00.000Z'),
  });
  await conversationRepository.create(conversation);
  return conversation;
}

async function build() {
  const conversationParticipantRepository = new InMemoryConversationParticipantRepository();
  const conversationRepository = new InMemoryConversationRepository(
    conversationParticipantRepository,
  );
  const restaurantRepository = {
    findById: async (id: RestaurantId) => ({
      organizationId: { value: 'org-1' },
      restaurantId: id,
    }),
  };
  const useCase = new ListRestaurantConversationsUseCase(
    conversationRepository,
    restaurantRepository as never,
    fakeConfigService(),
  );
  return { useCase, conversationRepository };
}

describe('ListRestaurantConversationsUseCase (D15 Dual Actor, branch restriction)', () => {
  it('an Employee with no branch restriction (empty branchIds) sees every restaurant conversation', async () => {
    const { useCase, conversationRepository } = await build();
    await seedConversation(conversationRepository, { branchId: branchIdA });
    await seedConversation(conversationRepository, { branchId: branchIdB });
    await seedConversation(conversationRepository, { branchId: null });

    const result = await useCase.execute({ actor: employeeActor(), restaurantId });

    expect(result.items).toHaveLength(3);
  });

  it('an Employee restricted to branchIdA sees only branchIdA plus restaurant-wide conversations', async () => {
    const { useCase, conversationRepository } = await build();
    await seedConversation(conversationRepository, { branchId: branchIdA });
    await seedConversation(conversationRepository, { branchId: branchIdB });
    await seedConversation(conversationRepository, { branchId: null });

    const result = await useCase.execute({
      actor: employeeActor({ branchIds: [branchIdA] }),
      restaurantId,
    });

    expect(result.items).toHaveLength(2);
  });

  it('an OrganizationMember Owner sees every restaurant conversation regardless of branch', async () => {
    const { useCase, conversationRepository } = await build();
    await seedConversation(conversationRepository, { branchId: branchIdA });
    await seedConversation(conversationRepository, { branchId: branchIdB });

    const result = await useCase.execute({ actor: orgMemberActor(), restaurantId });

    expect(result.items).toHaveLength(2);
  });

  it('denies an Employee scoped to a different restaurantId (IDOR-safe, D14)', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: employeeActor({ restaurantId: '55555555-5555-4555-8555-555555555555' }),
        restaurantId,
      }),
    ).rejects.toThrow(ConversationNotFoundException);
  });

  it('denies an OrganizationMember from a different organization (IDOR-safe, D14)', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ actor: orgMemberActor({ organizationId: 'org-2' }), restaurantId }),
    ).rejects.toThrow(ConversationNotFoundException);
  });

  it('denies an Employee lacking the conversations:manage permission (403)', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ actor: employeeActor({ permissions: [] }), restaurantId }),
    ).rejects.toThrow(PermissionDeniedException);
  });

  it('denies an OrganizationMember Staff role (insufficient org role, 403)', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: orgMemberActor({ orgRole: OrganizationMemberRole.Staff }),
        restaurantId,
      }),
    ).rejects.toThrow(PermissionDeniedException);
  });

  it('denies an Employee restricted to a branch not assigned when the conversation is branch-specific', async () => {
    const { useCase, conversationRepository } = await build();
    await seedConversation(conversationRepository, { branchId: branchIdA });

    // The branch-assignment gate is evaluated against the actor/branch pair,
    // not per-row, so an Employee scoped to a branch they are NOT assigned to
    // is still admitted to the list call itself (only rows they may see are
    // filtered) - the 403 for an unassigned specific branchId is exercised in
    // `assertActorCanManageConversation.spec.ts`. Here we assert the filter
    // never leaks a conversation belonging to an unassigned branch.
    const result = await useCase.execute({
      actor: employeeActor({ branchIds: [branchIdB] }),
      restaurantId,
    });

    expect(result.items).toHaveLength(0);
  });
});
