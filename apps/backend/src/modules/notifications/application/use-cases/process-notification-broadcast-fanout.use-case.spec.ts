import { Notification } from '../../domain/entities/notification.entity';
import { NotificationBroadcast } from '../../domain/entities/notification-broadcast.entity';
import { NotificationBroadcastSenderType, NotificationBroadcastStatus } from '../../domain/enums/notification-broadcast.enums';
import { ProcessNotificationBroadcastFanoutUseCase } from './process-notification-broadcast-fanout.use-case';

const now = new Date('2026-08-12T12:00:00.000Z');
const broadcastId = 'b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0';

/** A single hex digit repeated into a well-formed UUID v4 shape, for readable test fixture ids. */
function uid(n: number): string {
  const d = n.toString(16);
  return `${d.repeat(8)}-${d.repeat(4)}-4${d.repeat(3)}-8${d.repeat(3)}-${d.repeat(12)}`;
}

function newBroadcast(overrides: Partial<Parameters<typeof NotificationBroadcast.create>[0]> = {}) {
  return NotificationBroadcast.create({
    id: broadcastId,
    senderType: NotificationBroadcastSenderType.PlatformAdmin,
    senderId: 'admin-1',
    organizationId: null,
    title: 'Title',
    body: 'Body',
    totalRecipients: null,
    now,
    ...overrides,
  });
}

function inMemoryBroadcastRepository(initial: NotificationBroadcast | null) {
  let stored = initial;
  return {
    save: jest.fn(async (b: NotificationBroadcast) => {
      stored = b;
    }),
    findById: jest.fn(async () => stored),
  };
}

function build(params: {
  broadcast: NotificationBroadcast | null;
  batches: Array<{ userIds: string[]; nextCursor: string | null }>;
  saveManyInsertedCount?: number;
  realtimeBroadcastImpl?: () => Promise<void>;
}) {
  const broadcastRepository = inMemoryBroadcastRepository(params.broadcast);
  let batchCall = 0;
  const customerAudienceReader = {
    listBroadcastEligibleCustomerBatch: jest.fn(async () => {
      const batch = params.batches[batchCall] ?? { userIds: [], nextCursor: null };
      batchCall += 1;
      return batch;
    }),
  };
  const notificationRepository = {
    saveMany: jest.fn(async (notifications: unknown[]) => ({
      insertedCount: params.saveManyInsertedCount ?? notifications.length,
    })),
  };
  const realtimeBroadcaster = {
    broadcast: jest.fn(
      async (_rooms: string[], _envelope: unknown): Promise<void> => {
        if (params.realtimeBroadcastImpl) {
          await params.realtimeBroadcastImpl();
        }
      },
    ),
  };
  const fanoutScheduler = {
    enqueueFanout: jest.fn(),
    enqueueContinuation: jest.fn().mockResolvedValue(undefined),
  };
  const clock = { now: () => now };
  let counter = 0;
  const idGenerator = { generate: () => `id-${(counter += 1)}` };

  const useCase = new ProcessNotificationBroadcastFanoutUseCase(
    broadcastRepository as never,
    customerAudienceReader as never,
    notificationRepository as never,
    realtimeBroadcaster as never,
    fanoutScheduler as never,
    clock as never,
    idGenerator as never,
  );

  return {
    useCase,
    broadcastRepository,
    customerAudienceReader,
    notificationRepository,
    realtimeBroadcaster,
    fanoutScheduler,
  };
}

describe('ProcessNotificationBroadcastFanoutUseCase', () => {
  it('is a no-op when the broadcast does not exist', async () => {
    const { useCase, notificationRepository } = build({ broadcast: null, batches: [] });
    await useCase.execute({ broadcastId, isFinalAttempt: false });
    expect(notificationRepository.saveMany).not.toHaveBeenCalled();
  });

  it('is idempotent - a stale/duplicate job for an already-Completed broadcast no-ops', async () => {
    const completed = newBroadcast().start(now).complete(now);
    const { useCase, notificationRepository, broadcastRepository } = build({
      broadcast: completed,
      batches: [],
    });

    await useCase.execute({ broadcastId, isFinalAttempt: false });

    expect(notificationRepository.saveMany).not.toHaveBeenCalled();
    expect(broadcastRepository.save).not.toHaveBeenCalled();
  });

  it('is idempotent for an already-Failed broadcast too', async () => {
    const failed = newBroadcast().start(now).fail(now);
    const { useCase, notificationRepository } = build({ broadcast: failed, batches: [] });

    await useCase.execute({ broadcastId, isFinalAttempt: false });

    expect(notificationRepository.saveMany).not.toHaveBeenCalled();
  });

  it('transitions Pending -> Processing before processing any batch', async () => {
    const { useCase, broadcastRepository } = build({
      broadcast: newBroadcast(),
      batches: [{ userIds: [], nextCursor: null }],
    });

    await useCase.execute({ broadcastId, isFinalAttempt: false });

    const finalState = await broadcastRepository.findById();
    expect(finalState?.status).toBe(NotificationBroadcastStatus.Completed);
  });

  it('completes immediately when the audience is already empty', async () => {
    const { useCase, notificationRepository, broadcastRepository, realtimeBroadcaster } = build({
      broadcast: newBroadcast(),
      batches: [{ userIds: [], nextCursor: null }],
    });

    await useCase.execute({ broadcastId, isFinalAttempt: false });

    expect(notificationRepository.saveMany).not.toHaveBeenCalled();
    expect(realtimeBroadcaster.broadcast).not.toHaveBeenCalled();
    const finalState = await broadcastRepository.findById();
    expect(finalState?.status).toBe(NotificationBroadcastStatus.Completed);
  });

  it('processes a single exhausting batch: bulk-inserts, records counters, emits one realtime hint per batch, and completes', async () => {
    const { useCase, notificationRepository, broadcastRepository, realtimeBroadcaster } = build({
      broadcast: newBroadcast(),
      batches: [{ userIds: [uid(1), uid(2), uid(3)], nextCursor: null }],
    });

    await useCase.execute({ broadcastId, isFinalAttempt: false, correlationId: 'corr-1' });

    expect(notificationRepository.saveMany).toHaveBeenCalledTimes(1);
    const notifications = notificationRepository.saveMany.mock.calls[0][0] as Notification[];
    expect(notifications).toHaveLength(3);
    expect(notifications.map((n) => n.userId.value)).toEqual([uid(1), uid(2), uid(3)]);

    expect(realtimeBroadcaster.broadcast).toHaveBeenCalledTimes(1);
    const rooms = realtimeBroadcaster.broadcast.mock.calls[0][0];
    const envelope = realtimeBroadcaster.broadcast.mock.calls[0][1];
    expect(rooms).toEqual([`user:${uid(1)}`, `user:${uid(2)}`, `user:${uid(3)}`]);
    expect(envelope).toMatchObject({
      eventType: 'NotificationBroadcastDelivered',
      aggregateType: 'NotificationBroadcast',
      aggregateId: broadcastId,
      correlationId: 'corr-1',
      data: { broadcastId },
    });

    const finalState = await broadcastRepository.findById();
    expect(finalState?.status).toBe(NotificationBroadcastStatus.Completed);
    expect(finalState?.processedCount).toBe(3);
    expect(finalState?.succeededCount).toBe(3);
  });

  it('records skipped (already-delivered) rows from a retried batch as failedCount, not an error', async () => {
    const { useCase, broadcastRepository } = build({
      broadcast: newBroadcast(),
      batches: [{ userIds: [uid(1), uid(2), uid(3)], nextCursor: null }],
      saveManyInsertedCount: 1, // 2 of the 3 were already delivered (unique-index skip)
    });

    await useCase.execute({ broadcastId, isFinalAttempt: false });

    const finalState = await broadcastRepository.findById();
    expect(finalState?.succeededCount).toBe(1);
    expect(finalState?.failedCount).toBe(2);
    expect(finalState?.processedCount).toBe(3);
  });

  it('processes multiple batches within one run and resumes from the cursor across batches', async () => {
    const { useCase, notificationRepository, customerAudienceReader } = build({
      broadcast: newBroadcast(),
      batches: [
        { userIds: [uid(1), uid(2)], nextCursor: uid(2) },
        { userIds: [uid(3)], nextCursor: null },
      ],
    });

    await useCase.execute({ broadcastId, isFinalAttempt: false });

    expect(notificationRepository.saveMany).toHaveBeenCalledTimes(2);
    expect(customerAudienceReader.listBroadcastEligibleCustomerBatch).toHaveBeenNthCalledWith(
      1,
      null,
      expect.any(Number),
    );
    expect(customerAudienceReader.listBroadcastEligibleCustomerBatch).toHaveBeenNthCalledWith(
      2,
      uid(2),
      expect.any(Number),
    );
  });

  it('self-enqueues a deterministic continuation job when the batch budget is exhausted before the audience is', async () => {
    // NOTIFICATION_BROADCAST_BATCHES_PER_RUN batches, each reporting more to come.
    const batches = Array.from({ length: 5 }, (_, i) => ({
      userIds: [uid(i)],
      nextCursor: uid(i),
    }));
    const { useCase, fanoutScheduler, broadcastRepository } = build({
      broadcast: newBroadcast(),
      batches,
    });

    await useCase.execute({ broadcastId, isFinalAttempt: false, correlationId: 'corr-1' });

    expect(fanoutScheduler.enqueueContinuation).toHaveBeenCalledWith(broadcastId, uid(4), 'corr-1');
    const finalState = await broadcastRepository.findById();
    expect(finalState?.status).toBe(NotificationBroadcastStatus.Processing);
  });

  it('resumes from the broadcast own lastProcessedUserId cursor on a continuation job run', async () => {
    const inProgress = newBroadcast()
      .start(now)
      .recordBatch({ batchSize: 2, succeeded: 2, failed: 0, lastProcessedUserId: uid(2), at: now });
    const { useCase, customerAudienceReader } = build({
      broadcast: inProgress,
      batches: [{ userIds: [uid(3)], nextCursor: null }],
    });

    await useCase.execute({ broadcastId, isFinalAttempt: false });

    expect(customerAudienceReader.listBroadcastEligibleCustomerBatch).toHaveBeenCalledWith(
      uid(2),
      expect.any(Number),
    );
  });

  it('swallows a realtime broadcast failure - Notification rows and broadcast state still commit', async () => {
    const { useCase, broadcastRepository, notificationRepository } = build({
      broadcast: newBroadcast(),
      batches: [{ userIds: [uid(1)], nextCursor: null }],
      realtimeBroadcastImpl: async () => {
        throw new Error('socket outage');
      },
    });

    await expect(useCase.execute({ broadcastId, isFinalAttempt: false })).resolves.toBeUndefined();

    expect(notificationRepository.saveMany).toHaveBeenCalledTimes(1);
    const finalState = await broadcastRepository.findById();
    expect(finalState?.status).toBe(NotificationBroadcastStatus.Completed);
  });

  it('marks the broadcast Failed and rethrows when the final BullMQ attempt errors', async () => {
    const customerAudienceReader = {
      listBroadcastEligibleCustomerBatch: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const broadcastRepository = inMemoryBroadcastRepository(newBroadcast());
    const notificationRepository = { saveMany: jest.fn() };
    const realtimeBroadcaster = { broadcast: jest.fn() };
    const fanoutScheduler = { enqueueFanout: jest.fn(), enqueueContinuation: jest.fn() };
    const clock = { now: () => now };
    const idGenerator = { generate: () => 'id' };

    const useCase = new ProcessNotificationBroadcastFanoutUseCase(
      broadcastRepository as never,
      customerAudienceReader as never,
      notificationRepository as never,
      realtimeBroadcaster as never,
      fanoutScheduler as never,
      clock as never,
      idGenerator as never,
    );

    await expect(useCase.execute({ broadcastId, isFinalAttempt: true })).rejects.toThrow('db down');

    const finalState = await broadcastRepository.findById();
    expect(finalState?.status).toBe(NotificationBroadcastStatus.Failed);
  });

  it('rethrows without marking Failed when it is not the final attempt (lets BullMQ retry)', async () => {
    const customerAudienceReader = {
      listBroadcastEligibleCustomerBatch: jest.fn().mockRejectedValue(new Error('transient')),
    };
    const broadcastRepository = inMemoryBroadcastRepository(newBroadcast());
    const notificationRepository = { saveMany: jest.fn() };
    const realtimeBroadcaster = { broadcast: jest.fn() };
    const fanoutScheduler = { enqueueFanout: jest.fn(), enqueueContinuation: jest.fn() };
    const clock = { now: () => now };
    const idGenerator = { generate: () => 'id' };

    const useCase = new ProcessNotificationBroadcastFanoutUseCase(
      broadcastRepository as never,
      customerAudienceReader as never,
      notificationRepository as never,
      realtimeBroadcaster as never,
      fanoutScheduler as never,
      clock as never,
      idGenerator as never,
    );

    await expect(useCase.execute({ broadcastId, isFinalAttempt: false })).rejects.toThrow('transient');

    const finalState = await broadcastRepository.findById();
    expect(finalState?.status).toBe(NotificationBroadcastStatus.Processing);
  });
});
