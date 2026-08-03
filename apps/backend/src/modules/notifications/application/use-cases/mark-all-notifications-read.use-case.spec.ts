import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { MarkAllNotificationsReadUseCase } from './mark-all-notifications-read.use-case';

describe('MarkAllNotificationsReadUseCase', () => {
  const now = new Date('2026-07-25T12:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';

  const userActor: AuthenticatedActor = {
    actorType: AccessTokenActorType.User,
    userId,
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
  };

  function build() {
    const notificationRepository = {
      markAllReadByUser: jest.fn().mockResolvedValue(undefined),
      countUnreadByUser: jest.fn(),
      findById: jest.fn(),
      save: jest.fn(),
      listByUser: jest.fn(),
    };
    const clock = { now: () => now };
    const useCase = new MarkAllNotificationsReadUseCase(
      notificationRepository as never,
      clock as never,
    );
    return { useCase, notificationRepository };
  }

  it('issues a single bulk update scoped to the caller userId, at the clock time', async () => {
    const { useCase, notificationRepository } = build();

    await useCase.execute({ actor: userActor });

    expect(notificationRepository.markAllReadByUser).toHaveBeenCalledTimes(1);
    const [passedUserId, passedAt] = notificationRepository.markAllReadByUser.mock.calls[0];
    expect((passedUserId as UserId).value).toBe(userId);
    expect(passedAt).toBe(now);
  });
});
