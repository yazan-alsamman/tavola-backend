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
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { OfferRepository, OFFER_REPOSITORY } from '../../domain/repositories/offer.repository';
import { OfferStatus } from '../../domain/enums/offer.enums';
import {
  OfferExpirationSchedulerPort,
  OFFER_EXPIRATION_SCHEDULER,
} from '../ports/offer-expiration-scheduler.port';
import { assertBranchesBelongToRestaurant } from '../services/assert-branches-belong-to-restaurant';
import { OfferNotFoundException } from '../../domain/exceptions/offer-not-found.exception';
import { InvalidOfferStatusTransitionException } from '../../domain/exceptions/invalid-offer-status-transition.exception';
import { OfferUpdatedEvent } from '../../domain/events/offer.events';
import { toOfferResult } from '../mappers/offer-result.mapper';
import { UpdateOfferCommand } from '../dto/update-offer.command';
import { OfferResult } from '../dto/offer.result';

/**
 * Full-replace update (ADR-047): a Draft or Published offer may be edited,
 * an Expired one may not. The repository's conditional `UPDATE ... WHERE
 * status IN ('Draft','Published')` (`updateIfEditable`) is the concurrency
 * authority against a race with the expiration job. Editing a Published
 * offer's end re-schedules its expiration job after the commit.
 */
@Injectable()
export class UpdateOfferUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(OFFER_REPOSITORY) private readonly offerRepository: OfferRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(OFFER_EXPIRATION_SCHEDULER)
    private readonly expirationScheduler: OfferExpirationSchedulerPort,
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

    await assertBranchesBelongToRestaurant(
      this.branchRepository,
      command.conditions.branchIds,
      restaurantId,
    );

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
        ...command.conditions,
      },
      now,
    );

    await this.unitOfWork.execute(async () => {
      const applied = await this.offerRepository.updateIfEditable(updated);
      if (!applied) {
        throw new InvalidOfferStatusTransitionException(
          `Cannot update offer "${offerId.value}" - it has expired or was deleted.`,
        );
      }
    });

    if (
      updated.status === OfferStatus.Published &&
      updated.endsAt.getTime() !== existing.endsAt.getTime()
    ) {
      await this.expirationScheduler.scheduleExpiration(
        offerId.value,
        restaurant.organizationId.value,
        updated.endsAt,
        command.correlationId,
      );
    }

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

    return toOfferResult(updated, now);
  }
}
