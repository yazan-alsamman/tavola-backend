import { FloorPlanAreaId, FloorPlanId } from '@shared/domain/value-objects/identifiers.vo';
import { FloorPlanAreaRepository } from '../../domain/repositories/floor-plan-area.repository';
import { FloorPlanAreaNotFoundException } from '../../domain/exceptions/floor-plan-area-not-found.exception';

/**
 * ADR-040 - the single place all three Table write paths (Create, Update, Move)
 * turn a requested `floorPlanAreaId` into a value the entity may accept.
 *
 * `null`/`undefined` in means "no area" and short-circuits without a database
 * round trip. Anything else must resolve to a live Area of `floorPlanId`
 * itself: the compound lookup rejects an unknown id, an id belonging to
 * ANOTHER FloorPlan, and a soft-deleted Area identically, with the same
 * `FloorPlanAreaNotFoundException` - the IDOR-safe "unknown and forbidden look
 * the same" pattern this module already applies to
 * `FloorPlanRepository.findByIdAndBranchId`. Because `floorPlanId` is always
 * the caller's already-tenant-verified plan, a cross-tenant area id can never
 * resolve here.
 *
 * Exists as a shared function rather than being inlined three times so the
 * cross-plan invariant has exactly one implementation to audit; the composite
 * foreign key in `schema.prisma` is the structural backstop underneath it.
 */
export async function resolveFloorPlanAreaId(
  floorPlanAreaRepository: FloorPlanAreaRepository,
  floorPlanId: FloorPlanId,
  requestedAreaId: string | null | undefined,
): Promise<string | null> {
  if (requestedAreaId === null || requestedAreaId === undefined) {
    return null;
  }

  const area = await floorPlanAreaRepository.findByIdAndFloorPlanId(
    FloorPlanAreaId.create(requestedAreaId),
    floorPlanId,
  );
  if (area === null) {
    throw new FloorPlanAreaNotFoundException();
  }
  return area.floorPlanAreaId.value;
}
