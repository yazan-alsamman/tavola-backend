import { Notification } from './notification.entity';
import { NotificationPushStatus } from '../enums/notification.enums';
import { InvalidNotificationPushTransitionException } from '../exceptions/invalid-notification-push-transition.exception';
import { InvalidNotificationException } from '../exceptions/invalid-notification.exception';

describe('Notification', () => {
  const now = new Date('2026-07-25T12:00:00.000Z');

  function createNotification(): Notification {
    return Notification.create({
      id: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      type: 'ReservationApproved',
      templateId: '33333333-3333-4333-8333-333333333333',
      title: 'Reservation confirmed',
      body: 'Your reservation has been confirmed.',
      data: { reservationId: '44444444-4444-4444-8444-444444444444' },
      now,
    });
  }

  it('starts unread and NotAttempted push', () => {
    const notification = createNotification();
    expect(notification.read).toBe(false);
    expect(notification.readAt).toBeNull();
    expect(notification.pushStatus).toBe(NotificationPushStatus.NotAttempted);
  });

  it('rejects an empty title or body', () => {
    expect(() =>
      Notification.create({
        id: '1',
        userId: 'u',
        type: 't',
        templateId: null,
        title: '  ',
        body: 'b',
        data: null,
        now,
      }),
    ).toThrow(InvalidNotificationException);
    expect(() =>
      Notification.create({
        id: '1',
        userId: 'u',
        type: 't',
        templateId: null,
        title: 't',
        body: '  ',
        data: null,
        now,
      }),
    ).toThrow(InvalidNotificationException);
  });

  describe('read track', () => {
    it('markRead transitions false -> true and sets readAt', () => {
      const at = new Date('2026-07-25T13:00:00.000Z');
      const read = createNotification().markRead(at);
      expect(read.read).toBe(true);
      expect(read.readAt).toEqual(at);
    });

    it('markRead on an already-read notification is an idempotent no-op', () => {
      const at1 = new Date('2026-07-25T13:00:00.000Z');
      const at2 = new Date('2026-07-25T14:00:00.000Z');
      const readOnce = createNotification().markRead(at1);
      const readTwice = readOnce.markRead(at2);
      expect(readTwice.readAt).toEqual(at1);
    });

    it('read/push tracks are independent - marking read never touches pushStatus', () => {
      const notification = createNotification().enqueuePush('idem-1', now);
      const read = notification.markRead(now);
      expect(read.pushStatus).toBe(NotificationPushStatus.Queued);
    });
  });

  describe('push track', () => {
    it('NotAttempted -> Queued via enqueuePush, storing the idempotency key', () => {
      const queued = createNotification().enqueuePush('idem-key-1', now);
      expect(queued.pushStatus).toBe(NotificationPushStatus.Queued);
      expect(queued.pushIdempotencyKey).toBe('idem-key-1');
    });

    it('Queued -> Accepted via recordPushAccepted, setting pushSentAt/pushProviderMessageId', () => {
      const at = new Date('2026-07-25T13:00:00.000Z');
      const accepted = createNotification()
        .enqueuePush('idem-1', now)
        .recordPushAccepted('msg-1', at);
      expect(accepted.pushStatus).toBe(NotificationPushStatus.Accepted);
      expect(accepted.pushSentAt).toEqual(at);
      expect(accepted.pushProviderMessageId).toBe('msg-1');
    });

    it('Queued -> Failed via recordPushFailed, setting pushFailedAt/pushFailureReason', () => {
      const at = new Date('2026-07-25T13:00:00.000Z');
      const failed = createNotification()
        .enqueuePush('idem-1', now)
        .recordPushFailed('no_subscription', at);
      expect(failed.pushStatus).toBe(NotificationPushStatus.Failed);
      expect(failed.pushFailedAt).toEqual(at);
      expect(failed.pushFailureReason).toBe('no_subscription');
    });

    it('rejects enqueuePush from a non-NotAttempted state', () => {
      const queued = createNotification().enqueuePush('idem-1', now);
      expect(() => queued.enqueuePush('idem-2', now)).toThrow(
        InvalidNotificationPushTransitionException,
      );
    });

    it('rejects recordPushAccepted/recordPushFailed directly from NotAttempted (must be Queued first)', () => {
      const notification = createNotification();
      expect(() => notification.recordPushAccepted('msg-1', now)).toThrow(
        InvalidNotificationPushTransitionException,
      );
      expect(() => notification.recordPushFailed('provider_error', now)).toThrow(
        InvalidNotificationPushTransitionException,
      );
    });

    it('Accepted is terminal - rejects any further push transition', () => {
      const accepted = createNotification()
        .enqueuePush('idem-1', now)
        .recordPushAccepted('msg-1', now);
      expect(() => accepted.recordPushFailed('provider_error', now)).toThrow(
        InvalidNotificationPushTransitionException,
      );
    });

    it('Failed is terminal - rejects any further push transition (no retry-to-Accepted at the row level)', () => {
      const failed = createNotification()
        .enqueuePush('idem-1', now)
        .recordPushFailed('provider_error', now);
      expect(() => failed.recordPushAccepted('msg-1', now)).toThrow(
        InvalidNotificationPushTransitionException,
      );
    });
  });
});
