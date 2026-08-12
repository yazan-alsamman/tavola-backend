import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import { NotificationBroadcastId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RealtimeBroadcasterPort,
  REALTIME_BROADCASTER,
} from '@modules/realtime/domain/ports/realtime-broadcaster.port';
import { RealtimeEnvelope } from '@modules/realtime/application/realtime-envelope';
import { buildCanonicalRoom, RoomType } from '@modules/realtime/application/room';
import { Notification } from '../../domain/entities/notification.entity';
import { NotificationBroadcast } from '../../domain/entities/notification-broadcast.entity';
import { NotificationBroadcastStatus } from '../../domain/enums/notification-broadcast.enums';
import {
  NOTIFICATION_BROADCAST_REPOSITORY,
  NotificationBroadcastRepository,
} from '../../domain/repositories/notification-broadcast.repository';
import {
  NOTIFICATION_REPOSITORY,
  NotificationRepository,
} from '../../domain/repositories/notification.repository';
import {
  CUSTOMER_AUDIENCE_READER,
  CustomerAudienceReaderPort,
} from '../ports/customer-audience-reader.port';
import {
  NOTIFICATION_BROADCAST_FANOUT_SCHEDULER,
  NotificationBroadcastFanoutSchedulerPort,
} from '../ports/notification-broadcast-fanout-scheduler.port';
import {
  NOTIFICATION_BROADCAST_BATCH_SIZE,
  NOTIFICATION_BROADCAST_BATCHES_PER_RUN,
} from '../../infrastructure/bullmq/notification-broadcast-queue.constants';

export interface ProcessNotificationBroadcastFanoutCommand {
  broadcastId: string;
  isFinalAttempt: boolean;
  correlationId?: string;
}

/**
 * Phase 19.9 (ADR-037) — `NotificationBroadcastFanoutProcessor`'s sole
 * delegate. Processes up to `NOTIFICATION_BROADCAST_BATCHES_PER_RUN` keyset
 * batches per job execution, bulk-inserting `Notification` rows
 * (idempotent under retry via the `[broadcastId, userId]` unique index) and
 * emitting exactly one realtime hint per DB batch - never one per recipient
 * (ADR-037 Decision #6). Self-enqueues a deterministic continuation job when
 * the audience outlives this run's batch budget, so no single job run is
 * unbounded and no HTTP request ever blocks on a broadcast's full fan-out.
 */
@Injectable()
export class ProcessNotificationBroadcastFanoutUseCase {
  private readonly logger = new Logger(ProcessNotificationBroadcastFanoutUseCase.name);

  constructor(
    @Inject(NOTIFICATION_BROADCAST_REPOSITORY)
    private readonly broadcastRepository: NotificationBroadcastRepository,
    @Inject(CUSTOMER_AUDIENCE_READER)
    private readonly customerAudienceReader: CustomerAudienceReaderPort,
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly notificationRepository: NotificationRepository,
    @Inject(REALTIME_BROADCASTER) private readonly realtimeBroadcaster: RealtimeBroadcasterPort,
    @Inject(NOTIFICATION_BROADCAST_FANOUT_SCHEDULER)
    private readonly fanoutScheduler: NotificationBroadcastFanoutSchedulerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async execute(command: ProcessNotificationBroadcastFanoutCommand): Promise<void> {
    const broadcastId = NotificationBroadcastId.create(command.broadcastId);
    let broadcast = await this.broadcastRepository.findById(broadcastId);
    if (broadcast === null) {
      this.logger.error(
        `ProcessNotificationBroadcastFanoutUseCase: broadcast ${command.broadcastId} not found - skipping.`,
      );
      return;
    }

    // Idempotent re-entrancy guard - mirrors ProcessNotificationDeliveryUseCase's
    // `pushStatus !== Queued` check for the exact same reason (a stale/duplicate job run).
    if (
      broadcast.status === NotificationBroadcastStatus.Completed ||
      broadcast.status === NotificationBroadcastStatus.Failed
    ) {
      return;
    }

    try {
      if (broadcast.status === NotificationBroadcastStatus.Pending) {
        broadcast = broadcast.start(this.clock.now());
        await this.broadcastRepository.save(broadcast);
      }

      let cursor = broadcast.lastProcessedUserId?.value ?? null;

      for (let i = 0; i < NOTIFICATION_BROADCAST_BATCHES_PER_RUN; i += 1) {
        const batch = await this.customerAudienceReader.listBroadcastEligibleCustomerBatch(
          cursor,
          NOTIFICATION_BROADCAST_BATCH_SIZE,
        );

        if (batch.userIds.length === 0) {
          broadcast = broadcast.complete(this.clock.now());
          await this.broadcastRepository.save(broadcast);
          return;
        }

        await this.processBatch(broadcast, batch.userIds, command.correlationId);
        broadcast = (await this.broadcastRepository.findById(broadcastId)) ?? broadcast;

        cursor = batch.nextCursor;
        if (cursor === null) {
          broadcast = broadcast.complete(this.clock.now());
          await this.broadcastRepository.save(broadcast);
          return;
        }
      }

      // Batch budget exhausted this run, audience not yet exhausted - every
      // loop iteration that produced a null cursor already returned above,
      // so `cursor` is guaranteed non-null here (TS can't narrow this across
      // the loop boundary itself).
      await this.fanoutScheduler.enqueueContinuation(broadcast.id, cursor!, command.correlationId);
    } catch (error) {
      if (command.isFinalAttempt) {
        const current = await this.broadcastRepository.findById(broadcastId);
        if (current !== null && current.status === NotificationBroadcastStatus.Processing) {
          await this.broadcastRepository.save(current.fail(this.clock.now()));
        }
      }
      throw error;
    }
  }

  private async processBatch(
    broadcast: NotificationBroadcast,
    userIds: readonly string[],
    correlationId: string | undefined,
  ): Promise<void> {
    const now = this.clock.now();
    const notifications = userIds.map((userId) =>
      Notification.create({
        id: this.idGenerator.generate(),
        userId,
        type: `${broadcast.senderType}Broadcast`,
        templateId: null,
        broadcastId: broadcast.id,
        title: broadcast.title,
        body: broadcast.body,
        data: null,
        now,
      }),
    );

    const { insertedCount } = await this.notificationRepository.saveMany(notifications);
    const skipped = notifications.length - insertedCount;

    const updated = broadcast.recordBatch({
      batchSize: userIds.length,
      succeeded: insertedCount,
      failed: skipped,
      lastProcessedUserId: userIds[userIds.length - 1],
      at: now,
    });
    await this.broadcastRepository.save(updated);

    await this.broadcastRealtimeHint(broadcast.id, userIds, now, correlationId);
  }

  /**
   * One Socket.IO emit call reaching every recipient in this batch's own
   * `user:{userId}` room - never a per-recipient `NotificationCreatedEvent`
   * (ADR-037 Decision #6). Never rethrown - mirrors
   * `RealtimeEventPublisher`'s "a broadcast failure must never break the
   * triggering business transaction" contract; the Notification rows already
   * persisted above are the source of truth regardless.
   */
  private async broadcastRealtimeHint(
    broadcastId: string,
    userIds: readonly string[],
    now: Date,
    correlationId: string | undefined,
  ): Promise<void> {
    try {
      const rooms = userIds.map((userId) => buildCanonicalRoom(RoomType.User, userId));
      const envelope: RealtimeEnvelope = {
        eventId: this.idGenerator.generate(),
        eventType: 'NotificationBroadcastDelivered',
        occurredAt: now.toISOString(),
        aggregateType: 'NotificationBroadcast',
        aggregateId: broadcastId,
        correlationId: correlationId ?? null,
        data: { broadcastId },
      };
      await this.realtimeBroadcaster.broadcast(rooms, envelope);
    } catch (error) {
      this.logger.error(
        `ProcessNotificationBroadcastFanoutUseCase: realtime broadcast failed for broadcast ${broadcastId}: ${(error as Error).message}`,
      );
    }
  }
}
