import { NotificationBroadcast } from './notification-broadcast.entity';
import { NotificationBroadcastSenderType, NotificationBroadcastStatus } from '../enums/notification-broadcast.enums';
import { InvalidNotificationBroadcastException } from '../exceptions/invalid-notification-broadcast.exception';
import { InvalidNotificationBroadcastTransitionException } from '../exceptions/invalid-notification-broadcast-transition.exception';

const now = new Date('2026-08-12T10:00:00.000Z');
const later = new Date('2026-08-12T10:05:00.000Z');

function build(overrides: Partial<Parameters<typeof NotificationBroadcast.create>[0]> = {}) {
  return NotificationBroadcast.create({
    id: 'broadcast-1',
    senderType: NotificationBroadcastSenderType.PlatformAdmin,
    senderId: 'admin-1',
    organizationId: null,
    title: 'We are open this holiday!',
    body: 'Join us for a special menu.',
    totalRecipients: 100,
    now,
    ...overrides,
  });
}

describe('NotificationBroadcast', () => {
  describe('create', () => {
    it('starts Pending with zeroed counters and no cursor', () => {
      const broadcast = build();
      expect(broadcast.status).toBe(NotificationBroadcastStatus.Pending);
      expect(broadcast.processedCount).toBe(0);
      expect(broadcast.succeededCount).toBe(0);
      expect(broadcast.failedCount).toBe(0);
      expect(broadcast.lastProcessedUserId).toBeNull();
      expect(broadcast.totalRecipients).toBe(100);
    });

    it('rejects an empty title', () => {
      expect(() => build({ title: '   ' })).toThrow(InvalidNotificationBroadcastException);
    });

    it('rejects an empty body', () => {
      expect(() => build({ body: '' })).toThrow(InvalidNotificationBroadcastException);
    });

    it('rejects an empty senderId', () => {
      expect(() => build({ senderId: '' })).toThrow(InvalidNotificationBroadcastException);
    });
  });

  describe('status transitions', () => {
    it('Pending -> Processing via start()', () => {
      const broadcast = build().start(later);
      expect(broadcast.status).toBe(NotificationBroadcastStatus.Processing);
    });

    it('rejects recordBatch while still Pending', () => {
      const broadcast = build();
      expect(() =>
        broadcast.recordBatch({
          batchSize: 10,
          succeeded: 10,
          failed: 0,
          lastProcessedUserId: '10101010-1010-4010-8010-101010101010',
          at: later,
        }),
      ).toThrow(InvalidNotificationBroadcastTransitionException);
    });

    it('recordBatch advances counters and cursor while Processing', () => {
      const broadcast = build()
        .start(now)
        .recordBatch({ batchSize: 10, succeeded: 8, failed: 2, lastProcessedUserId: '10101010-1010-4010-8010-101010101010', at: later });

      expect(broadcast.processedCount).toBe(10);
      expect(broadcast.succeededCount).toBe(8);
      expect(broadcast.failedCount).toBe(2);
      expect(broadcast.lastProcessedUserId?.value).toBe('10101010-1010-4010-8010-101010101010');
      expect(broadcast.status).toBe(NotificationBroadcastStatus.Processing);
    });

    it('recordBatch accumulates across multiple batches', () => {
      const broadcast = build()
        .start(now)
        .recordBatch({ batchSize: 10, succeeded: 10, failed: 0, lastProcessedUserId: '10101010-1010-4010-8010-101010101010', at: later })
        .recordBatch({ batchSize: 5, succeeded: 5, failed: 0, lastProcessedUserId: '15151515-1515-4015-8015-151515151515', at: later });

      expect(broadcast.processedCount).toBe(15);
      expect(broadcast.succeededCount).toBe(15);
      expect(broadcast.lastProcessedUserId?.value).toBe('15151515-1515-4015-8015-151515151515');
    });

    it('complete() is terminal and fills totalRecipients from processedCount when it was never set', () => {
      const broadcast = build({ totalRecipients: null })
        .start(now)
        .recordBatch({ batchSize: 7, succeeded: 7, failed: 0, lastProcessedUserId: '07070707-0707-4007-8007-070707070707', at: later })
        .complete(later);

      expect(broadcast.status).toBe(NotificationBroadcastStatus.Completed);
      expect(broadcast.totalRecipients).toBe(7);
    });

    it('complete() never overwrites a totalRecipients snapshot taken at creation', () => {
      const broadcast = build({ totalRecipients: 100 })
        .start(now)
        .recordBatch({ batchSize: 7, succeeded: 7, failed: 0, lastProcessedUserId: '07070707-0707-4007-8007-070707070707', at: later })
        .complete(later);

      expect(broadcast.totalRecipients).toBe(100);
    });

    it('rejects recordBatch after Completed (terminal, write-once)', () => {
      const broadcast = build().start(now).complete(now);
      expect(() =>
        broadcast.recordBatch({
          batchSize: 1,
          succeeded: 1,
          failed: 0,
          lastProcessedUserId: '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a',
          at: later,
        }),
      ).toThrow(InvalidNotificationBroadcastTransitionException);
    });

    it('fail() is terminal from Processing', () => {
      const broadcast = build().start(now).fail(later);
      expect(broadcast.status).toBe(NotificationBroadcastStatus.Failed);
    });

    it('rejects fail() after Completed', () => {
      const broadcast = build().start(now).complete(now);
      expect(() => broadcast.fail(later)).toThrow(InvalidNotificationBroadcastTransitionException);
    });

    it('rejects starting an already-Processing broadcast', () => {
      const broadcast = build().start(now);
      expect(() => broadcast.start(later)).toThrow(InvalidNotificationBroadcastTransitionException);
    });
  });

  describe('reconstitute/toProps round-trip', () => {
    it('preserves every field', () => {
      const original = build()
        .start(now)
        .recordBatch({ batchSize: 3, succeeded: 3, failed: 0, lastProcessedUserId: '03030303-0303-4003-8003-030303030303', at: later });
      const restored = NotificationBroadcast.reconstitute(original.toProps());
      expect(restored.toProps()).toEqual(original.toProps());
    });
  });
});
