import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { InMemoryRestaurantRepository } from '../../restaurants/support/in-memory-restaurant.repository';

export const WAITLIST_OWNER_USER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** A restaurant repository holding the one restaurant the waitlist specs use. */
export async function restaurantRepositoryWith(
  restaurantId: string,
  now: Date,
): Promise<InMemoryRestaurantRepository> {
  const repository = new InMemoryRestaurantRepository();
  await repository.save(
    Restaurant.create({
      id: restaurantId,
      organizationId: 'org-1',
      name: 'Beirut Nights',
      slug: 'beirut-nights',
      logoId: null,
      coverImageId: null,
      description: null,
      cuisineType: null,
      averageRating: null,
      priceLevel: null,
      status: RestaurantStatus.Active,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }),
  );
  return repository;
}

export function organizationMemberActor(
  orgRole: 'Owner' | 'Admin' | 'Billing' | 'Staff' = 'Owner',
): AuthenticatedOrganizationMemberActor {
  return {
    actorType: AccessTokenActorType.OrganizationMember,
    userId: WAITLIST_OWNER_USER_ID,
    sessionId: 'session-owner',
    sessionVersion: 1,
    tokenFamilyId: 'family-owner',
    organizationId: 'org-1',
    orgRole,
    permissionsVersion: 1,
  } as AuthenticatedOrganizationMemberActor;
}
