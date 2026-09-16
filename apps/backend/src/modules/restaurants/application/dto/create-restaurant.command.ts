/**
 * Carries the acting tenant identity as two plain fields rather than an
 * `AuthenticatedOrganizationMemberActor`.
 *
 * The use case only ever read `actor.organizationId` and `actor.userId`, and
 * the actor type itself is meaningful only on the ordinary tenant pipeline:
 * ADR-022 is explicit that `PlatformAdmin` is deliberately *not* modelled as
 * an `AuthenticatedActor`, because that type belongs to a JWT pipeline
 * Platform Admin tokens never travel through. Keeping the actor object here
 * would have forced `PlatformAdminCreateRestaurantUseCase` to fabricate a
 * fake `OrganizationMember` actor to satisfy the type — blurring exactly the
 * isolation boundary that ADR requires.
 *
 * `organizationId` is server-derived in both callers: from the caller's own
 * JWT on the tenant route, and from a validated, existence-checked path/body
 * parameter on the Platform Admin route. `actorId` is attribution only (it
 * lands on `RestaurantCreatedEvent`), never an authorization input — both
 * routes have already authorized the caller by the time this runs.
 */
export interface CreateRestaurantCommand {
  organizationId: string;
  actorId: string;
  name: string;
  slug?: string;
  description: string | null;
  cuisineType: string | null;
  priceLevel: number | null;
  correlationId?: string;
}
