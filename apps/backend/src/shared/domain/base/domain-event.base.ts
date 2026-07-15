/**
 * Immutable domain event envelope.
 * Application layer publishes these after successful state transitions.
 */
export abstract class DomainEvent {
  public readonly eventId: string;
  public readonly occurredAt: Date;
  public readonly correlationId?: string;

  protected constructor(eventId: string, occurredAt: Date, correlationId?: string) {
    this.eventId = eventId;
    this.occurredAt = new Date(occurredAt.getTime());
    this.correlationId = correlationId;
  }

  protected seal(): void {
    Object.freeze(this);
  }

  abstract readonly eventName: string;
}
