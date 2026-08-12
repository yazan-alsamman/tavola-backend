import { Entity } from '@shared/domain/base/entity.base';
import { NotificationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { NotificationPushStatus } from '../enums/notification.enums';
import { InvalidNotificationException } from '../exceptions/invalid-notification.exception';
import { InvalidNotificationPushTransitionException } from '../exceptions/invalid-notification-push-transition.exception';

export interface NotificationProps {
  id: string;
  userId: string;
  type: string;
  templateId: string | null;
  /** Phase 19.9 (ADR-037) — set only for a broadcast-originated row; null otherwise. */
  broadcastId: string | null;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read: boolean;
  readAt: Date | null;
  pushStatus: NotificationPushStatus;
  pushSentAt: Date | null;
  pushFailedAt: Date | null;
  pushFailureReason: string | null;
  pushIdempotencyKey: string | null;
  pushProviderMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Notification Aggregate (Phase 9, architecture frozen 2026-07-25,
 * TASKS.md's "Phase 9 — Notification System: Pre-implementation architecture
 * decisions"). Durable, `userId`-owned only (decision item 2) - REST/the
 * database is the source of truth, Phase 8 WebSocket delivery is only a
 * best-effort realtime hint layered on top, never a substitute.
 *
 * Two independent state tracks (decision item 5), enforced separately:
 * READ (`read`/`readAt`): `false -> true`, one-way, idempotent (calling
 * `markRead` on an already-read notification is a no-op, not an error -
 * matches `PATCH .../read-all`'s bulk semantics needing no per-row guard).
 * PUSH (`pushStatus`): `NotAttempted -> Queued -> {Accepted | Failed}` -
 * both `Accepted`/`Failed` are terminal AS PERSISTED VALUES; the row
 * receives at most one terminal push write ever (EVENTS.md's Notification
 * Events section - BullMQ's own internal per-attempt retries never touch
 * this row, only the final outcome does).
 */
export class Notification extends Entity<NotificationProps> {
  private static readonly ALLOWED_PUSH_TRANSITIONS: Readonly<
    Record<NotificationPushStatus, readonly NotificationPushStatus[]>
  > = {
    [NotificationPushStatus.NotAttempted]: [NotificationPushStatus.Queued],
    [NotificationPushStatus.Queued]: [
      NotificationPushStatus.Accepted,
      NotificationPushStatus.Failed,
    ],
    [NotificationPushStatus.Accepted]: [],
    [NotificationPushStatus.Failed]: [],
  };

  private constructor(props: NotificationProps) {
    super(props);
  }

  /**
   * The only way a new Notification is created (`NotificationDispatcher`).
   * `read`/`pushStatus` always start at their initial values - never
   * parameters - mirroring `Reservation.create()`'s "status is always
   * Pending, unconditional" precedent.
   */
  static create(props: {
    id: string;
    userId: string;
    type: string;
    templateId: string | null;
    broadcastId?: string | null;
    title: string;
    body: string;
    data: Record<string, unknown> | null;
    now: Date;
  }): Notification {
    validate(props);
    return new Notification({
      id: props.id,
      userId: props.userId,
      type: props.type,
      templateId: props.templateId,
      broadcastId: props.broadcastId ?? null,
      title: props.title,
      body: props.body,
      data: props.data,
      read: false,
      readAt: null,
      pushStatus: NotificationPushStatus.NotAttempted,
      pushSentAt: null,
      pushFailedAt: null,
      pushFailureReason: null,
      pushIdempotencyKey: null,
      pushProviderMessageId: null,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: NotificationProps): Notification {
    return new Notification({ ...props });
  }

  get notificationId(): NotificationId {
    return NotificationId.create(this.props.id);
  }

  get userId(): UserId {
    return UserId.create(this.props.userId);
  }

  get type(): string {
    return this.props.type;
  }

  get templateId(): string | null {
    return this.props.templateId;
  }

  get broadcastId(): string | null {
    return this.props.broadcastId;
  }

  get title(): string {
    return this.props.title;
  }

  get body(): string {
    return this.props.body;
  }

  get data(): Record<string, unknown> | null {
    return this.props.data;
  }

  get read(): boolean {
    return this.props.read;
  }

  get readAt(): Date | null {
    return this.props.readAt ? new Date(this.props.readAt.getTime()) : null;
  }

  get pushStatus(): NotificationPushStatus {
    return this.props.pushStatus;
  }

  get pushSentAt(): Date | null {
    return this.props.pushSentAt ? new Date(this.props.pushSentAt.getTime()) : null;
  }

  get pushFailedAt(): Date | null {
    return this.props.pushFailedAt ? new Date(this.props.pushFailedAt.getTime()) : null;
  }

  get pushFailureReason(): string | null {
    return this.props.pushFailureReason;
  }

  get pushIdempotencyKey(): string | null {
    return this.props.pushIdempotencyKey;
  }

  get pushProviderMessageId(): string | null {
    return this.props.pushProviderMessageId;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  /** Idempotent - already-read is a no-op, never an error (`PATCH .../read-all` relies on this). */
  markRead(at: Date): Notification {
    if (this.props.read) {
      return this;
    }
    return Notification.reconstitute({
      ...this.props,
      read: true,
      readAt: at,
      updatedAt: at,
    });
  }

  /**
   * `NotificationDispatcher`'s push-eligible branch only, called once per
   * Notification, immediately after `create()`. `idempotencyKey` is
   * generated once here and reused verbatim across every BullMQ retry
   * (decision item 9) - never regenerated per attempt.
   */
  enqueuePush(idempotencyKey: string, at: Date): Notification {
    this.assertPushTransition(NotificationPushStatus.Queued);
    return Notification.reconstitute({
      ...this.props,
      pushStatus: NotificationPushStatus.Queued,
      pushIdempotencyKey: idempotencyKey,
      updatedAt: at,
    });
  }

  /** `RecordPushOutcomeUseCase`'s terminal-success write - `NotificationQueue`'s processor only. */
  recordPushAccepted(providerMessageId: string, at: Date): Notification {
    this.assertPushTransition(NotificationPushStatus.Accepted);
    return Notification.reconstitute({
      ...this.props,
      pushStatus: NotificationPushStatus.Accepted,
      pushSentAt: at,
      pushProviderMessageId: providerMessageId,
      updatedAt: at,
    });
  }

  /**
   * `RecordPushOutcomeUseCase`'s terminal-failure write - covers
   * `noRecipients` (reason `no_subscription`), `permanentFailure` (reason
   * `provider_error`), and a `retryableFailure` whose BullMQ retry budget is
   * exhausted (reason `rate_limited`/`provider_error`). Never retried again
   * after this write.
   */
  recordPushFailed(reason: string, at: Date): Notification {
    this.assertPushTransition(NotificationPushStatus.Failed);
    return Notification.reconstitute({
      ...this.props,
      pushStatus: NotificationPushStatus.Failed,
      pushFailedAt: at,
      pushFailureReason: reason,
      updatedAt: at,
    });
  }

  private assertPushTransition(target: NotificationPushStatus): void {
    const allowed = Notification.ALLOWED_PUSH_TRANSITIONS[this.props.pushStatus];
    if (!allowed.includes(target)) {
      throw new InvalidNotificationPushTransitionException(
        `Cannot transition notification push status from "${this.props.pushStatus}" to "${target}".`,
      );
    }
  }

  toProps(): Readonly<NotificationProps> {
    return { ...this.props };
  }
}

function validate(props: { title: string; body: string; userId: string; type: string }): void {
  if (props.title.trim().length === 0) {
    throw new InvalidNotificationException('Notification must have a non-empty title.');
  }
  if (props.body.trim().length === 0) {
    throw new InvalidNotificationException('Notification must have a non-empty body.');
  }
  if (props.userId.trim().length === 0) {
    throw new InvalidNotificationException('Notification must have a userId.');
  }
  if (props.type.trim().length === 0) {
    throw new InvalidNotificationException('Notification must have a type.');
  }
}
