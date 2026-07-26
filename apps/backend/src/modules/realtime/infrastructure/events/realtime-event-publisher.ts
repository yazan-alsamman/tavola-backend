import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainEvent } from '@shared/domain/base/domain-event.base';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { AuditingEventPublisher } from '@modules/authentication/infrastructure/events/auditing-event-publisher';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RealtimeBroadcasterPort,
  REALTIME_BROADCASTER,
} from '../../domain/ports/realtime-broadcaster.port';
import { mapDomainEventForRealtime } from '../../application/realtime-event-mapping';
import { RealtimeEnvelope } from '../../application/realtime-envelope';

/**
 * Phase 8 §2/§3 — the OUTERMOST `EVENT_PUBLISHER` decorator, wrapping
 * `AuditingEventPublisher` (which itself wraps `LoggingEventPublisher`). Every
 * existing `eventPublisher.publish(...)` call site across the codebase is
 * unchanged - only `AuthenticationModule`'s `EVENT_PUBLISHER` binding moves
 * from `AuditingEventPublisher` to this class (see `RealtimeModule`).
 *
 * Contract (frozen, non-negotiable): `inner.publish` runs to completion
 * FIRST and unconditionally. Realtime fan-out is then attempted inside its
 * own try/catch - any failure (mapping, room resolution, or the broadcaster
 * itself) is logged and swallowed, never rethrown. A realtime outage must
 * never turn a successful HTTP command into a 5xx, fail a successful BullMQ
 * job, or make committed state look rolled back.
 */
@Injectable()
export class RealtimeEventPublisher implements EventPublisherPort {
  private readonly logger = new Logger(RealtimeEventPublisher.name);

  constructor(
    @Inject(AuditingEventPublisher) private readonly inner: EventPublisherPort,
    @Inject(REALTIME_BROADCASTER) private readonly broadcaster: RealtimeBroadcasterPort,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
  ) {}

  async publish(event: DomainEvent): Promise<void> {
    await this.inner.publish(event);
    await this.broadcastSafely(event);
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    await this.inner.publishAll(events);
    for (const event of events) {
      await this.broadcastSafely(event);
    }
  }

  private async broadcastSafely(event: DomainEvent): Promise<void> {
    try {
      const mapping = await mapDomainEventForRealtime(event, {
        resolveRestaurantIdForBranch: (branchId) => this.resolveRestaurantIdForBranch(branchId),
      });
      if (mapping === null) {
        return;
      }

      const occurredAt = event.occurredAt.toISOString();
      const correlationId = event.correlationId ?? null;

      if (mapping.staffRooms.length > 0) {
        const staffEnvelope: RealtimeEnvelope = {
          eventId: event.eventId,
          eventType: event.eventName,
          occurredAt,
          aggregateType: mapping.aggregateType,
          aggregateId: mapping.aggregateId,
          correlationId,
          data: mapping.staffPayload,
        };
        await this.broadcaster.broadcast(mapping.staffRooms, staffEnvelope);
      }

      if (mapping.reservationRoom !== null && mapping.customerPayload !== null) {
        const customerEnvelope: RealtimeEnvelope = {
          eventId: event.eventId,
          eventType: event.eventName,
          occurredAt,
          aggregateType: mapping.aggregateType,
          aggregateId: mapping.aggregateId,
          correlationId,
          data: mapping.customerPayload,
        };
        await this.broadcaster.broadcast([mapping.reservationRoom], customerEnvelope);
      }
    } catch (error) {
      this.logger.error(
        `Realtime broadcast failed for ${event.eventName} (${event.eventId}): ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private async resolveRestaurantIdForBranch(branchId: string): Promise<string | null> {
    const branch = await this.branchRepository.findById(BranchId.create(branchId));
    return branch ? branch.restaurantId.value : null;
  }
}
