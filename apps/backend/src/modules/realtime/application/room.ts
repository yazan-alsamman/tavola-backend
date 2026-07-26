/**
 * Phase 8 §9 — exactly these four room types; the frozen freeze note is
 * explicit that no future room type (`waitlist:{id}`, `notification:{id}`,
 * `conversation:{id}`, ...) belongs in this list without a new architecture
 * freeze. Client `room.subscribe`/`room.unsubscribe` payloads name one of
 * these four strings - anything else is rejected before any authorization
 * logic runs (`UnknownRoomTypeException`).
 */
export enum RoomType {
  Organization = 'organization',
  Restaurant = 'restaurant',
  Branch = 'branch',
  Reservation = 'reservation',
}

export function isRoomType(value: unknown): value is RoomType {
  return (
    value === RoomType.Organization ||
    value === RoomType.Restaurant ||
    value === RoomType.Branch ||
    value === RoomType.Reservation
  );
}

/**
 * The SERVER builds this string after authorization succeeds (§9/§12) - a
 * client-supplied room name is never trusted as an authorization input, only
 * a `{ roomType, resourceId }` pair naming what the client wants to join.
 */
export function buildCanonicalRoom(roomType: RoomType, resourceId: string): string {
  return `${roomType}:${resourceId}`;
}

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Phase 8 §12 — "reject malformed resource IDs according to the repository's
 * existing ID conventions" (every id in this repository is a `UuidId`, see
 * `shared/domain/value-objects/uuid-id.vo.ts`'s identical pattern). Checked
 * BEFORE any repository lookup so a malformed id gets its own ack code
 * (`INVALID_RESOURCE_ID`) rather than being folded into the generic
 * not-found/forbidden collapse `RoomAuthorizationService` uses for
 * IDOR-safety - a malformed id can never correspond to a real resource, so
 * surfacing this distinction leaks nothing.
 */
export function isWellFormedResourceId(value: string): boolean {
  return UUID_V4_REGEX.test(value.trim());
}
