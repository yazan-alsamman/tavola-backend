import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { Notification } from '../../domain/entities/notification.entity';
import { NotificationPage } from '../../domain/repositories/notification.repository';
import { ListNotificationsUseCase } from './list-notifications.use-case';

describe('ListNotificationsUseCase', () => {
  const now = new Date('2026-07-25T12:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';

  const userActor: AuthenticatedActor = {
    actorType: AccessTokenActorType.User,
    userId,
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
  };

  function notification(id: string, overrides: { read?: boolean } = {}): Notification {
    const created = Notification.create({
      id,
      userId,
      type: 'ReservationApproved',
      templateId: null,
      title: 'Title',
      body: 'Body',
      data: { reservationId: 'r-1' },
      now,
    });
    return overrides.read ? created.markRead(now) : created;
  }

  function build(page: NotificationPage) {
    const notificationRepository = {
      listByUser: jest.fn().mockResolvedValue(page),
      countUnreadByUser: jest.fn(),
      findById: jest.fn(),
      save: jest.fn(),
      markAllReadByUser: jest.fn(),
    };
    const useCase = new ListNotificationsUseCase(notificationRepository as never);
    return { useCase, notificationRepository };
  }

  it('maps repository Notifications to the client-facing NotificationResult shape', async () => {
    const { useCase } = build({
      items: [notification('n-1'), notification('n-2', { read: true })],
      total: 2,
    });

    const result = await useCase.execute({
      actor: userActor,
      page: 1,
      limit: 20,
      unreadOnly: false,
    });

    expect(result).toEqual({
      items: [
        {
          id: 'n-1',
          type: 'ReservationApproved',
          title: 'Title',
          body: 'Body',
          data: { reservationId: 'r-1' },
          read: false,
          readAt: null,
          createdAt: now,
        },
        {
          id: 'n-2',
          type: 'ReservationApproved',
          title: 'Title',
          body: 'Body',
          data: { reservationId: 'r-1' },
          read: true,
          readAt: now,
          createdAt: now,
        },
      ],
      page: 1,
      limit: 20,
      total: 2,
    });
  });

  it('passes page/limit and scopes to the caller userId', async () => {
    const { useCase, notificationRepository } = build({ items: [], total: 0 });

    await useCase.execute({ actor: userActor, page: 3, limit: 10, unreadOnly: false });

    const [passedUserId, passedPage, passedLimit] = notificationRepository.listByUser.mock.calls[0];
    expect(passedUserId.value).toBe(userId);
    expect(passedPage).toBe(3);
    expect(passedLimit).toBe(10);
  });

  it('forwards the unreadOnly filter to the repository', async () => {
    const { useCase, notificationRepository } = build({ items: [], total: 0 });

    await useCase.execute({ actor: userActor, page: 1, limit: 20, unreadOnly: true });

    expect(notificationRepository.listByUser).toHaveBeenCalledWith(expect.anything(), 1, 20, {
      unreadOnly: true,
    });
  });

  it('returns an empty page without error when there are no notifications', async () => {
    const { useCase } = build({ items: [], total: 0 });

    const result = await useCase.execute({
      actor: userActor,
      page: 1,
      limit: 20,
      unreadOnly: false,
    });

    expect(result).toEqual({ items: [], page: 1, limit: 20, total: 0 });
  });
});
