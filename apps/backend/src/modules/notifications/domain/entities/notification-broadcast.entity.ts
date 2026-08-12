import { Entity } from '@shared/domain/base/entity.base';
import { NotificationBroadcastId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import {
  NotificationBroadcastSenderType,
  NotificationBroadcastStatus,
} from '../enums/notification-broadcast.enums';
import { InvalidNotificationBroadcastException } from '../exceptions/invalid-notification-broadcast.exception';
import { InvalidNotificationBroadcastTransitionException } from '../exceptions/invalid-notification-broadcast-transition.exception';

export interface NotificationBroadcastProps {
  id: string;
  senderType: NotificationBroadcastSenderType;
  senderId: string;
  organizationId: string | null;
  title: string;
  body: string;
  totalRecipients: number | null;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  status: NotificationBroadcastStatus;
  lastProcessedUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * NotificationBroadcast Aggregate (Phase 19.9, ADR-037). Tracks one Platform
 * Admin or Restaurant Owner "send to all eligible Customers" action end to
 * end: idempotency/resume anchor (`lastProcessedUserId`, a keyset cursor over
 * `User.id`) for `NotificationBroadcastFanoutProcessor`, plus the
 * observability counters the approved product spec requires. `organizationId`
 * is audit/traceability only for an `OrganizationMember` sender — it is never
 * used to scope the (global) audience, per ADR-037 Decision #4/#8.
 *
 * Status lifecycle: `Pending -> Processing -> {Completed | Failed}`, mirroring
 * `Notification.pushStatus`'s own terminal-write-once state machine.
 */
export class NotificationBroadcast extends Entity<NotificationBroadcastProps> {
  private static readonly ALLOWED_TRANSITIONS: Readonly<
    Record<NotificationBroadcastStatus, readonly NotificationBroadcastStatus[]>
  > = {
    [NotificationBroadcastStatus.Pending]: [
      NotificationBroadcastStatus.Processing,
      NotificationBroadcastStatus.Failed,
    ],
    [NotificationBroadcastStatus.Processing]: [
      NotificationBroadcastStatus.Completed,
      NotificationBroadcastStatus.Failed,
    ],
    [NotificationBroadcastStatus.Completed]: [],
    [NotificationBroadcastStatus.Failed]: [],
  };

  private constructor(props: NotificationBroadcastProps) {
    super(props);
  }

  /**
   * The only way a new broadcast is created (`CreateNotificationBroadcastService`,
   * at HTTP-request time, before the BullMQ kickoff job is even enqueued).
   * `totalRecipients` is a point-in-time audience-size snapshot (resolved via
   * `CustomerAudienceReaderPort.countEligibleCustomers()` by the caller) -
   * purely observability, never a strict contract the fan-out must match
   * (the eligible audience can shift between kickoff and processing).
   */
  static create(props: {
    id: string;
    senderType: NotificationBroadcastSenderType;
    senderId: string;
    organizationId: string | null;
    title: string;
    body: string;
    totalRecipients: number | null;
    now: Date;
  }): NotificationBroadcast {
    validate(props);
    return new NotificationBroadcast({
      id: props.id,
      senderType: props.senderType,
      senderId: props.senderId,
      organizationId: props.organizationId,
      title: props.title,
      body: props.body,
      totalRecipients: props.totalRecipients,
      processedCount: 0,
      succeededCount: 0,
      failedCount: 0,
      status: NotificationBroadcastStatus.Pending,
      lastProcessedUserId: null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: NotificationBroadcastProps): NotificationBroadcast {
    return new NotificationBroadcast({ ...props });
  }

  get broadcastId(): NotificationBroadcastId {
    return NotificationBroadcastId.create(this.props.id);
  }

  get senderType(): NotificationBroadcastSenderType {
    return this.props.senderType;
  }

  get senderId(): string {
    return this.props.senderId;
  }

  get organizationId(): string | null {
    return this.props.organizationId;
  }

  get title(): string {
    return this.props.title;
  }

  get body(): string {
    return this.props.body;
  }

  get totalRecipients(): number | null {
    return this.props.totalRecipients;
  }

  get processedCount(): number {
    return this.props.processedCount;
  }

  get succeededCount(): number {
    return this.props.succeededCount;
  }

  get failedCount(): number {
    return this.props.failedCount;
  }

  get status(): NotificationBroadcastStatus {
    return this.props.status;
  }

  get lastProcessedUserId(): UserId | null {
    return this.props.lastProcessedUserId ? UserId.create(this.props.lastProcessedUserId) : null;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  /** `NotificationBroadcastFanoutProcessor`'s first job run for this broadcast only. */
  start(at: Date): NotificationBroadcast {
    this.assertTransition(NotificationBroadcastStatus.Processing);
    return NotificationBroadcast.reconstitute({
      ...this.props,
      status: NotificationBroadcastStatus.Processing,
      updatedAt: at,
    });
  }

  /**
   * One call per DB-insert batch. `succeeded`/`failed` are the batch's own
   * counts (failed = rows skipped by `createMany({ skipDuplicates: true })`
   * on retry - already-delivered, not an error) - `processedCount` always
   * advances by the full batch size so the cursor and the counters can never
   * drift apart under a partially-retried batch.
   */
  recordBatch(params: {
    batchSize: number;
    succeeded: number;
    failed: number;
    lastProcessedUserId: string;
    at: Date;
  }): NotificationBroadcast {
    if (this.props.status !== NotificationBroadcastStatus.Processing) {
      throw new InvalidNotificationBroadcastTransitionException(
        `Cannot record a batch while broadcast status is "${this.props.status}".`,
      );
    }
    return NotificationBroadcast.reconstitute({
      ...this.props,
      processedCount: this.props.processedCount + params.batchSize,
      succeededCount: this.props.succeededCount + params.succeeded,
      failedCount: this.props.failedCount + params.failed,
      lastProcessedUserId: params.lastProcessedUserId,
      updatedAt: params.at,
    });
  }

  /** The fan-out processor's terminal-success write - audience exhausted, no fatal error. */
  complete(at: Date): NotificationBroadcast {
    this.assertTransition(NotificationBroadcastStatus.Completed);
    return NotificationBroadcast.reconstitute({
      ...this.props,
      status: NotificationBroadcastStatus.Completed,
      totalRecipients: this.props.totalRecipients ?? this.props.processedCount,
      updatedAt: at,
    });
  }

  /** The fan-out processor's terminal-failure write - only after BullMQ's own retry budget is exhausted. */
  fail(at: Date): NotificationBroadcast {
    this.assertTransition(NotificationBroadcastStatus.Failed);
    return NotificationBroadcast.reconstitute({
      ...this.props,
      status: NotificationBroadcastStatus.Failed,
      updatedAt: at,
    });
  }

  private assertTransition(target: NotificationBroadcastStatus): void {
    const allowed = NotificationBroadcast.ALLOWED_TRANSITIONS[this.props.status];
    if (!allowed.includes(target)) {
      throw new InvalidNotificationBroadcastTransitionException(
        `Cannot transition notification broadcast status from "${this.props.status}" to "${target}".`,
      );
    }
  }

  toProps(): Readonly<NotificationBroadcastProps> {
    return { ...this.props };
  }
}

function validate(props: { title: string; body: string; senderId: string }): void {
  if (props.title.trim().length === 0) {
    throw new InvalidNotificationBroadcastException(
      'Notification broadcast must have a non-empty title.',
    );
  }
  if (props.body.trim().length === 0) {
    throw new InvalidNotificationBroadcastException(
      'Notification broadcast must have a non-empty body.',
    );
  }
  if (props.senderId.trim().length === 0) {
    throw new InvalidNotificationBroadcastException('Notification broadcast must have a senderId.');
  }
}
