import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

/**
 * `actor` is narrowed to `AuthenticatedOrganizationMemberActor`, not the full
 * `AuthenticatedActor` union - `OrganizationMemberGuard` (AUTHORIZATION_ARCHITECTURE.md
 * §8) structurally guarantees this actor type before the use case ever runs,
 * exactly like `RequirePermission`-guarded routes only ever reach their use
 * case with an Employee actor. No runtime re-check needed here.
 */
export interface CreateRestaurantCommand {
  actor: AuthenticatedOrganizationMemberActor;
  name: string;
  slug?: string;
  description: string | null;
  cuisineType: string | null;
  priceLevel: number | null;
  correlationId?: string;
}
