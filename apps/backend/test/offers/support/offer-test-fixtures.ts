import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { Offer } from '@modules/offers/domain/entities/offer.entity';
import { OfferDiscountType, OfferType } from '@modules/offers/domain/enums/offer.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';

export const FIXED_NOW = new Date('2026-08-01T10:00:00.000Z');

export function testRestaurant(overrides?: { id?: string; organizationId?: string }): Restaurant {
  return Restaurant.create({
    id: overrides?.id ?? '33333333-3333-4333-8333-333333333333',
    organizationId: overrides?.organizationId ?? '11111111-1111-4111-8111-111111111199',
    name: 'The Old Mill',
    slug: 'the-old-mill',
    logoId: null,
    coverImageId: null,
    description: null,
    cuisineType: null,
    averageRating: null,
    priceLevel: null,
    status: RestaurantStatus.Active,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    deletedAt: null,
  });
}

export function testOfferContent(overrides?: {
  type?: OfferType;
  title?: string;
  description?: string;
  discountType?: OfferDiscountType;
  discountValue?: number;
  startsAt?: Date;
  endsAt?: Date;
}) {
  return {
    type: overrides?.type ?? OfferType.Promotion,
    title: overrides?.title ?? '20% Off Weekday Lunch',
    description: overrides?.description ?? 'Enjoy 20% off any lunch entree.',
    discountType: overrides?.discountType ?? OfferDiscountType.Percentage,
    discountValue: overrides?.discountValue ?? 20,
    startsAt: overrides?.startsAt ?? new Date('2026-08-01T00:00:00.000Z'),
    endsAt: overrides?.endsAt ?? new Date('2026-08-31T23:59:59.000Z'),
  };
}

export function testOffer(overrides?: {
  id?: string;
  restaurantId?: string;
  content?: ReturnType<typeof testOfferContent>;
  now?: Date;
}): Offer {
  return Offer.create({
    id: overrides?.id ?? '22222222-2222-4222-8222-222222222222',
    restaurantId: overrides?.restaurantId ?? '33333333-3333-4333-8333-333333333333',
    content: overrides?.content ?? testOfferContent(),
    now: overrides?.now ?? FIXED_NOW,
  });
}

export function orgMemberActor(overrides?: { userId?: string; organizationId?: string }) {
  return {
    actorType: AccessTokenActorType.OrganizationMember as const,
    userId: overrides?.userId ?? '11111111-1111-4111-8111-111111111111',
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
    organizationId: overrides?.organizationId ?? '11111111-1111-4111-8111-111111111199',
    orgRole: 'Owner',
    permissionsVersion: 1,
  };
}
