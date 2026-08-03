import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { Notification } from '../../domain/entities/notification.entity';
import { NotificationNotFoundException } from '../../domain/exceptions/notification-not-found.exception';
import { MarkNotificationReadUseCase } from './mark-notification-read.use-case';

describe('MarkNotificationReadUseCase', () => {
  const now = new Date('2026-07-25T12:00:00.000Z');
  const userId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';
  const notificationId = '33333333-3333-4333-8333-333333333333';

  const userActor: AuthenticatedActor = {
    actorType: AccessTokenActorType.User,
    userId,
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
  };

  function ownedNotification(overrides: { userId?: string; read?: boolean } = {}): Notification {
    const created = Notification.create({
      id: notificationId,
      userId: overrides.userId ?? userId,
      type: 'ReservationApproved',
      templateId: null,
      title: 'Title',
      body: 'Body',
      data: null,
      now,
    });
    return overrides.read ? created.markRead(now) : created;
  }

  function build(notification: Notification | null) {
    const notificationRepository = {
      findById: jest.fn().mockResolvedValue(notification),
      save: jest.fn().mockResolvedValue(undefined),
      countUnreadByUser: jest.fn(),
      listByUser: jest.fn(),
      markAllReadByUser: jest.fn(),
    };
    const clock = { now: () => now };
    const useCase = new MarkNotificationReadUseCase(
      notificationRepository as never,
      clock as never,
    );
    return { useCase, notificationRepository };
  }

  it('marks an owned notification read and persists the update', async () => {
    const { useCase, notificationRepository } = build(ownedNotification());

    const result = await useCase.execute({ actor: userActor, notificationId });

    expect(result.read).toBe(true);
    expect(result.readAt).toEqual(now);
    const saved = notificationRepository.save.mock.calls[0][0] as Notification;
    expect(saved.read).toBe(true);
  });

  it('is idempotent - marking an already-read notification succeeds without error', async () => {
    const { useCase } = build(ownedNotification({ read: true }));

    const result = await useCase.execute({ actor: userActor, notificationId });

    expect(result.read).toBe(true);
  });

  it('throws NotificationNotFoundException when the notification does not exist', async () => {
    const { useCase, notificationRepository } = build(null);

    await expect(useCase.execute({ actor: userActor, notificationId })).rejects.toBeInstanceOf(
      NotificationNotFoundException,
    );
    expect(notificationRepository.save).not.toHaveBeenCalled();
  });

  it('throws the same NotificationNotFoundException (IDOR-safe) when the notification belongs to another user', async () => {
    const { useCase, notificationRepository } = build(ownedNotification({ userId: otherUserId }));

    await expect(useCase.execute({ actor: userActor, notificationId })).rejects.toBeInstanceOf(
      NotificationNotFoundException,
    );
    expect(notificationRepository.save).not.toHaveBeenCalled();
  });
});
