import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { OfferId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { OfferRepository, OFFER_REPOSITORY } from '../../domain/repositories/offer.repository';
import { OfferNotFoundException } from '../../domain/exceptions/offer-not-found.exception';
import { OfferStatus } from '../../domain/enums/offer.enums';
import { OfferDeletedEvent } from '../../domain/events/offer.events';
import {
  OfferExpirationSchedulerPort,
  OFFER_EXPIRATION_SCHEDULER,
} from '../ports/offer-expiration-scheduler.port';
import { DeleteOfferCommand } from '../dto/delete-offer.command';

/**
 * Phase 11 (Offers, architecture frozen 2026-07-28), owner decision D3: soft
 * delete only (ADR-010), reachable by Owner/Admin from any state (Draft/
 * Published/Expired). Not idempotent: deleting an already-deleted (or
 * unknown, or cross-restaurant) Offer 404s, matching every other resource's
 * existing convention. If the Offer was `Published`, its BullMQ expiration
 * job is cancelled - `expireIfPublished`'s own `deleted_at IS NULL` CAS
 * clause would make a stale, already-scheduled job a safe no-op regardless,
 * but cancelling here avoids ever firing a pointless `OfferExpired` event
 * for a resource that's already gone.
 */
@Injectable()
export class DeleteOfferUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(OFFER_REPOSITORY) private readonly offerRepository: OfferRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(OFFER_EXPIRATION_SCHEDULER)
    private readonly expirationScheduler: OfferExpirationSchedulerPort,
  ) {}

  async execute(command: DeleteOfferCommand): Promise<void> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const offerId = OfferId.create(command.offerId);
    const existing = await this.offerRepository.findByIdAndRestaurantId(offerId, restaurantId);
    if (existing === null) {
      throw new OfferNotFoundException();
    }

    const now = this.clock.now();
    await this.unitOfWork.execute(async () => {
      await this.offerRepository.softDelete(offerId, now);
    });

    if (existing.status === OfferStatus.Published) {
      await this.expirationScheduler.cancelExpiration(offerId.value);
    }

    await this.eventPublisher.publish(
      new OfferDeletedEvent(
        this.idGenerator.generate(),
        {
          offerId: offerId.value,
          restaurantId: restaurantId.value,
          deletedByUserId: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );
  }
}
