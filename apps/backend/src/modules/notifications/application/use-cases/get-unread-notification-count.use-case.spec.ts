import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { GetUnreadNotificationCountUseCase } from './get-unread-notification-count.use-case';

describe('GetUnreadNotificationCountUseCase', () => {
  const userId = '11111111-1111-4111-8111-111111111111';

  const userActor: AuthenticatedActor = {
    actorType: AccessTokenActorType.User,
    userId,
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
  };

  function build(count: number) {
    const notificationRepository = {
      countUnreadByUser: jest.fn().mockResolvedValue(count),
      findById: jest.fn(),
      save: jest.fn(),
      listByUser: jest.fn(),
      markAllReadByUser: jest.fn(),
    };
    const useCase = new GetUnreadNotificationCountUseCase(notificationRepository as never);
    return { useCase, notificationRepository };
  }

  it('returns the unread count scoped to the caller userId', async () => {
    const { useCase, notificationRepository } = build(7);

    const result = await useCase.execute({ actor: userActor });

    expect(result).toEqual({ count: 7 });
    expect(notificationRepository.countUnreadByUser).toHaveBeenCalledWith(
      expect.objectContaining({ value: userId }),
    );
    const passedUserId = notificationRepository.countUnreadByUser.mock.calls[0][0] as UserId;
    expect(passedUserId.value).toBe(userId);
  });

  it('returns zero when the caller has no unread notifications', async () => {
    const { useCase } = build(0);

    const result = await useCase.execute({ actor: userActor });

    expect(result).toEqual({ count: 0 });
  });
});
