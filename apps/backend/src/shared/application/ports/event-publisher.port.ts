import { DomainEvent } from '@shared/domain/base/domain-event.base';

export interface EventPublisherPort {
  publish(event: DomainEvent): Promise<void>;
  publishAll(events: DomainEvent[]): Promise<void>;
}
