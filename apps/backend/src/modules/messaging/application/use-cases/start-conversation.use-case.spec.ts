import { randomUUID } from 'crypto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  AuthenticatedEmployeeActor,
  AuthenticatedOrganizationMemberActor,
  AuthenticatedUserActor,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { ConversationId, RestaurantId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { InMemoryConversationRepository } from '../../../../../test/messaging/support/in-memory-conversation.repository';
import { InMemoryConversationParticipantRepository } from '../../../../../test/messaging/support/in-memory-conversation-participant.repository';
import { ConversationStartedEvent } from '../../domain/events/messaging.events';
import { ConversationNotFoundException } from '../../domain/exceptions/conversation-not-found.exception';
import { InvalidConversationException } from '../../domain/exceptions/invalid-conversation.exception';
import { StartConversationUseCase } from './start-conversation.use-case';

const now = new Date('2026-07-30T10:00:00.000Z');
const restaurantId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const customerUserId = '44444444-4444-4444-8444-444444444444';
const reservationId = '55555555-5555-4555-8555-555555555555';

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

async function build(
  options: {
    restaurantExistsPublicly?: boolean;
    branch?: { id: string; restaurantId: string } | null;
    reservation?: { id: string; restaurantId: string } | null;
    targetUserExists?: boolean;
  } = {},
) {
  const conversationParticipantRepository = new InMemoryConversationParticipantRepository();
  const conversationRepository = new InMemoryConversationRepository(
    conversationParticipantRepository,
  );

  const restaurantRepository = {
    existsPubliclyById: async () => options.restaurantExistsPublicly ?? true,
    findById: async (id: RestaurantId) => ({
      organizationId: { value: 'org-1' },
      restaurantId: id,
    }),
  };
  const branchRepository = {
    findById: async () =>
      options.branch ? { restaurantId: { value: options.branch.restaurantId } } : null,
    findByIdAndRestaurantId: async () =>
      options.branch ? { restaurantId: { value: options.branch.restaurantId } } : null,
  };
  const reservationRepository = {
    findById: async () =>
      options.reservation ? { restaurantId: { value: options.reservation.restaurantId } } : null,
  };
  const userRepository = {
    findById: async () => (options.targetUserExists === false ? null : { id: customerUserId }),
  };

  const events: ConversationStartedEvent[] = [];
  const eventPublisher = {
    publish: jest.fn(async (e: ConversationStartedEvent) => {
      events.push(e);
    }),
    publishAll: jest.fn(),
  };
  const unitOfWork = { execute: async <T>(work: () => Promise<T>) => work() };

  const useCase = new StartConversationUseCase(
    restaurantRepository as never,
    branchRepository as never,
    reservationRepository as never,
    userRepository as never,
    conversationRepository,
    conversationParticipantRepository,
    { now: () => now } as never,
    { generate: () => randomUUID() } as never,
    eventPublisher as never,
    unitOfWork as never,
  );

  return { useCase, conversationRepository, conversationParticipantRepository, events };
}

describe('StartConversationUseCase (D1/ADR-030 actor-branched restaurantId resolution)', () => {
  it('a Customer starts a conversation about themselves', async () => {
    const { useCase, conversationRepository, conversationParticipantRepository, events } =
      await build();

    const result = await useCase.execute({ actor: customerActor(), restaurantId });

    expect(result.restaurantId).toBe(restaurantId);
    expect(events[0]?.payload.customerUserId).toBe(customerUserId);
    const stored = await conversationRepository.findById(
      ConversationId.create(result.conversationId),
    );
    expect(stored).not.toBeNull();
    expect(
      conversationParticipantRepository.isCustomerParticipant(
        ConversationId.create(result.conversationId),
        UserId.create(customerUserId),
      ),
    ).toBe(true);
  });

  it('a Customer cannot start a conversation with a restaurant that does not exist publicly (IDOR-safe, D14)', async () => {
    const { useCase } = await build({ restaurantExistsPublicly: false });

    await expect(useCase.execute({ actor: customerActor(), restaurantId })).rejects.toThrow(
      ConversationNotFoundException,
    );
  });

  it('an Employee starts a conversation on behalf of an existing customer', async () => {
    const { useCase, events } = await build();

    const result = await useCase.execute({
      actor: employeeActor(),
      restaurantId,
      customerUserId,
    });

    expect(result.restaurantId).toBe(restaurantId);
    expect(events[0]?.payload.customerUserId).toBe(customerUserId);
  });

  it('an OrganizationMember Owner starts a conversation on behalf of an existing customer', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({
      actor: orgMemberActor(),
      restaurantId,
      customerUserId,
    });

    expect(result.restaurantId).toBe(restaurantId);
  });

  it('rejects a Restaurant-side actor that omits customerUserId', async () => {
    const { useCase } = await build();

    await expect(useCase.execute({ actor: employeeActor(), restaurantId })).rejects.toThrow(
      InvalidConversationException,
    );
  });

  it('rejects a customerUserId that does not reference an existing User', async () => {
    const { useCase } = await build({ targetUserExists: false });

    await expect(
      useCase.execute({ actor: employeeActor(), restaurantId, customerUserId }),
    ).rejects.toThrow(InvalidConversationException);
  });

  it('denies an Employee scoped to a different restaurant (IDOR-safe, D14)', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: employeeActor({ restaurantId: '99999999-9999-4999-8999-999999999999' }),
        restaurantId,
        customerUserId,
      }),
    ).rejects.toThrow(ConversationNotFoundException);
  });

  it('denies an OrganizationMember from a different organization (IDOR-safe, D14)', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: orgMemberActor({ organizationId: 'org-2' }),
        restaurantId,
        customerUserId,
      }),
    ).rejects.toThrow(ConversationNotFoundException);
  });

  it('rejects a reservationId that does not belong to restaurantId', async () => {
    const { useCase } = await build({
      reservation: { id: reservationId, restaurantId: '66666666-6666-4666-8666-666666666666' },
    });

    await expect(
      useCase.execute({ actor: customerActor(), restaurantId, reservationId }),
    ).rejects.toThrow(InvalidConversationException);
  });

  it('rejects a branchId that does not belong to restaurantId for a Customer actor', async () => {
    const { useCase } = await build({
      branch: { id: branchId, restaurantId: '66666666-6666-4666-8666-666666666666' },
    });

    await expect(
      useCase.execute({ actor: customerActor(), restaurantId, branchId }),
    ).rejects.toThrow(InvalidConversationException);
  });

  it('accepts a valid reservationId belonging to the restaurant and links it', async () => {
    const { useCase } = await build({ reservation: { id: reservationId, restaurantId } });

    const result = await useCase.execute({ actor: customerActor(), restaurantId, reservationId });

    expect(result.reservationId).toBe(reservationId);
  });
});
