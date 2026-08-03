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
import { InvalidOfferStatusTransitionException } from '../../domain/exceptions/invalid-offer-status-transition.exception';
import { OfferUpdatedEvent } from '../../domain/events/offer.events';
import { toOfferResult } from '../mappers/offer-result.mapper';
import { UpdateOfferCommand } from '../dto/update-offer.command';
import { OfferResult } from '../dto/offer.result';

/**
 * Phase 11 (Offers, architecture frozen 2026-07-28), owner decision D3:
 * full-replace update, reachable only while `status = Draft` - `Published`/
 * `Expired` are immutable. The repository's own conditional `UPDATE ...
 * WHERE status = 'Draft'` (`updateIfDraft`) is the actual concurrency
 * authority against a race with a concurrent Publish, mirroring
 * `CancelReservationUseCase`'s "if (!applied) throw" shape - the in-memory
 * `Offer.update()` check is a defensive first pass, not the final guarantee.
 */
@Injectable()
export class UpdateOfferUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(OFFER_REPOSITORY) private readonly offerRepository: OfferRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: UpdateOfferCommand): Promise<OfferResult> {
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
    const updated = existing.update(
      {
        type: command.type,
        title: command.title,
        description: command.description,
        discountType: command.discountType,
        discountValue: command.discountValue,
        startsAt: command.startsAt,
        endsAt: command.endsAt,
      },
      now,
    );

    let applied = false;
    await this.unitOfWork.execute(async () => {
      applied = await this.offerRepository.updateIfDraft(updated);
      if (!applied) {
        throw new InvalidOfferStatusTransitionException(
          `Cannot update offer "${offerId.value}" - it is no longer Draft.`,
        );
      }
    });

    await this.eventPublisher.publish(
      new OfferUpdatedEvent(
        this.idGenerator.generate(),
        {
          offerId: offerId.value,
          restaurantId: restaurantId.value,
          updatedByUserId: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );

    return toOfferResult(updated);
  }
}
