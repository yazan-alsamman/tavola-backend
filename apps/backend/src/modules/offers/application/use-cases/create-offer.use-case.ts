import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { Offer } from '../../domain/entities/offer.entity';
import { OfferRepository, OFFER_REPOSITORY } from '../../domain/repositories/offer.repository';
import { OfferCreatedEvent } from '../../domain/events/offer.events';
import { toOfferResult } from '../mappers/offer-result.mapper';
import { CreateOfferCommand } from '../dto/create-offer.command';
import { OfferResult } from '../dto/offer.result';

/**
 * Phase 11 (Offers, architecture frozen 2026-07-28). Owner/Admin only
 * (`OrganizationMemberGuard` + `@RequireOrgRole(Owner, Admin)` at the route)
 * - no Employee path, no `offers:*` permission slug (owner decision D4).
 * Always created as `Draft`.
 */
@Injectable()
export class CreateOfferUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(OFFER_REPOSITORY) private readonly offerRepository: OfferRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: CreateOfferCommand): Promise<OfferResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate - RestaurantRepository is already tenant-scoped
    // (OrganizationMemberGuard has bound the caller's organizationId into
    // TenantContext by this point); Offer itself carries no organizationId
    // (TENANCY.md, transitively tenant-owned like Review).
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const now = this.clock.now();
    const offer = Offer.create({
      id: this.idGenerator.generate(),
      restaurantId: restaurantId.value,
      content: {
        type: command.type,
        title: command.title,
        description: command.description,
        discountType: command.discountType,
        discountValue: command.discountValue,
        startsAt: command.startsAt,
        endsAt: command.endsAt,
      },
      now,
    });

    await this.unitOfWork.execute(async () => {
      await this.offerRepository.create(offer);
    });

    await this.eventPublisher.publish(
      new OfferCreatedEvent(
        this.idGenerator.generate(),
        {
          offerId: offer.offerId.value,
          restaurantId: restaurantId.value,
          createdByUserId: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );

    return toOfferResult(offer);
  }
}
