import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainEvent } from '@shared/domain/base/domain-event.base';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { RealtimeEventPublisher } from '@modules/realtime/infrastructure/events/realtime-event-publisher';
import { NotificationDispatcher } from '../../application/services/notification-dispatcher.service';

/**
 * Phase 9 (architecture frozen 2026-07-25) - the new OUTERMOST
 * `EVENT_PUBLISHER` decorator, wrapping `RealtimeEventPublisher` (which
 * itself wraps `AuditingEventPublisher`, which wraps `LoggingEventPublisher`).
 * Every existing `eventPublisher.publish(...)` call site is unchanged - only
 * `RealtimeModule`'s `EVENT_PUBLISHER` factory binding gains one more layer
 * (decision item 11: "Do not bypass the existing event publisher
 * architecture without a frozen reason").
 *
 * Contract, mirroring `RealtimeEventPublisher`'s own frozen one: `inner.publish`
 * (audit + realtime) runs to completion FIRST and unconditionally. Phase 9
 * dispatch is then attempted inside its own try/catch - any failure
 * (missing recipient, missing template, persistence error, enqueue error)
 * is logged and swallowed, never rethrown - a Notification pipeline failure
 * must never turn a successful business command into a 5xx, fail a
 * successful BullMQ job, or make committed state look rolled back
 * (decision item 11/12's accepted best-effort reliability boundary).
 *
 * When `NotificationDispatcher.dispatch` produces a `NotificationCreatedEvent`,
 * it is republished through `inner` (not `this`) so it also gets audited and
 * broadcast - never back through `this.dispatch` again, which would
 * needlessly re-run the Phase 9 allow-list check against an event that was
 * never on it in the first place.
 */
@Injectable()
export class NotifyingEventPublisher implements EventPublisherPort {
  private readonly logger = new Logger(NotifyingEventPublisher.name);

  constructor(
    @Inject(RealtimeEventPublisher) private readonly inner: EventPublisherPort,
    private readonly notificationDispatcher: NotificationDispatcher,
  ) {}

  async publish(event: DomainEvent): Promise<void> {
    await this.inner.publish(event);
    await this.dispatchSafely(event);
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    await this.inner.publishAll(events);
    for (const event of events) {
      await this.dispatchSafely(event);
    }
  }

  private async dispatchSafely(event: DomainEvent): Promise<void> {
    try {
      const notificationCreated = await this.notificationDispatcher.dispatch(event);
      if (notificationCreated !== null) {
        await this.inner.publish(notificationCreated);
      }
    } catch (error) {
      this.logger.error(
        `Notification dispatch failed for ${event.eventName} (${event.eventId}): ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }
}
