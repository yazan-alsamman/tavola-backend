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
import { OfferPublishedEvent } from '../../domain/events/offer.events';
import {
  OfferExpirationSchedulerPort,
  OFFER_EXPIRATION_SCHEDULER,
} from '../ports/offer-expiration-scheduler.port';
import { toOfferResult } from '../mappers/offer-result.mapper';
import { PublishOfferCommand } from '../dto/publish-offer.command';
import { OfferResult } from '../dto/offer.result';

/**
 * Phase 11 (Offers, architecture frozen 2026-07-28) - `Draft -> Published`
 * Domain Action, matching `ApproveReservationUseCase`'s "dedicated POST
 * action" shape rather than folding into PATCH. The repository's
 * conditional `UPDATE ... WHERE status = 'Draft'` (`publishIfDraft`) is the
 * concurrency authority; `Offer.publish()` additionally rejects an
 * already-elapsed window (`endsAt <= now`) before any write is attempted.
 *
 * Scheduling boundary (task instructions §9): the transaction commits first
 * (`unitOfWork.execute`), then - strictly after commit - the BullMQ
 * expiration job is scheduled for `endsAt`. An already-past-due `endsAt`
 * cannot reach here (`Offer.publish()` rejects it), so the scheduler always
 * receives a non-negative delay; `BullMqOfferExpirationScheduler` itself
 * still clamps to `>= 0` defensively, matching
 * `BullMqReservationExpirationScheduler`'s own precedent.
 */
@Injectable()
export class PublishOfferUseCase {
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

  async execute(command: PublishOfferCommand): Promise<OfferResult> {
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
    const published = existing.publish(now);

    let applied = false;
    await this.unitOfWork.execute(async () => {
      applied = await this.offerRepository.publishIfDraft(published);
      if (!applied) {
        throw new InvalidOfferStatusTransitionException(
          `Cannot publish offer "${offerId.value}" - it is no longer Draft.`,
        );
      }
    });

    // Post-commit: queue scheduling never happens inside the transaction.
    await this.expirationScheduler.scheduleExpiration(
      offerId.value,
      restaurant.organizationId.value,
      published.endsAt,
      command.correlationId,
    );

    await this.eventPublisher.publish(
      new OfferPublishedEvent(
        this.idGenerator.generate(),
        {
          offerId: offerId.value,
          restaurantId: restaurantId.value,
          publishedByUserId: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );

    return toOfferResult(published);
  }
}
