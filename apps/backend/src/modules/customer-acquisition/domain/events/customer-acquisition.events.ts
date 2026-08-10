import { DomainEvent } from '@shared/domain/base/domain-event.base';

/**
 * ADR-033 §25 (EVENTS.md "Customer Acquisition Events"). System-initiated -
 * published in the same transaction-adjacent flow as the triggering
 * Reservation's transition into Approved (ADR-033 §3), after that
 * transaction commits, exactly like `ReservationApprovedEvent` itself.
 */
export class CustomerAcquisitionRecordedEvent extends DomainEvent {
  public readonly eventName = 'CustomerAcquisitionRecorded';

  constructor(
    eventId: string,
    public readonly payload: {
      acquisitionId: string;
      restaurantId: string;
      customerIdentityKey: string;
      feeAmount: number;
      feeCurrency: string;
      pricingRuleId: string;
      sourceReservationId: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/** PlatformAdmin-initiated only, never automatic (ADR-033 §10). */
export class CustomerAcquisitionReversedEvent extends DomainEvent {
  public readonly eventName = 'CustomerAcquisitionReversed';

  constructor(
    eventId: string,
    public readonly payload: {
      acquisitionId: string;
      restaurantId: string;
      reversedBy: string;
      reversalReason: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/** PlatformAdmin-initiated, symmetric to Reversal - corrects an under-count (ADR-033 §11). */
export class CustomerAcquisitionManuallyRecordedEvent extends DomainEvent {
  public readonly eventName = 'CustomerAcquisitionManuallyRecorded';

  constructor(
    eventId: string,
    public readonly payload: {
      acquisitionId: string;
      restaurantId: string;
      customerIdentityKey: string;
      feeAmount: number;
      feeCurrency: string;
      recordedBy: string;
      reason: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}

/**
 * PlatformAdmin-initiated. No `PricingRuleUpdated` event exists - rules are
 * never edited in place (ADR-033 §15); a change is always a new
 * `AcquisitionPricingRuleActivated` plus the superseded rule's `archivedAt`
 * being set (no event for archiving alone - the row is the audit trail).
 */
export class AcquisitionPricingRuleActivatedEvent extends DomainEvent {
  public readonly eventName = 'AcquisitionPricingRuleActivated';

  constructor(
    eventId: string,
    public readonly payload: {
      ruleId: string;
      scopeType: string;
      scopeId: string | null;
      feeType: string;
      effectiveFrom: string;
      createdBy: string;
    },
    occurredAt: Date = new Date(),
    correlationId?: string,
  ) {
    super(eventId, occurredAt, correlationId);
  }
}
