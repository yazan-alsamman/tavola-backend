import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { DomainEvent } from '@shared/domain/base/domain-event.base';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';

@Injectable()
export class LoggingEventPublisher implements EventPublisherPort {
  constructor(private readonly logger: Logger) {}

  async publish(event: DomainEvent): Promise<void> {
    this.logger.log(
      { eventName: event.eventName, eventId: event.eventId, correlationId: event.correlationId },
      `[EventPublisher] ${event.eventName}`,
    );
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }
}
