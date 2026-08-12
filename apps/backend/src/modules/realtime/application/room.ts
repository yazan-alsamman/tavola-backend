/**
 * Phase 8 §9 — the original frozen four; Phase 15.6 (Messaging, DECISIONS.md
 * D9) adds `Conversation` as a fifth, the specific addition this freeze note
 * had anticipated and gated behind "a new architecture freeze." Phase 19.9
 * (ADR-037) adds `User` as a sixth, under that same equivalent freeze — a
 * self-only room (`actor.userId === resourceId`, no repository lookup) that
 * `RealtimeGateway` auto-joins every `User`-actor socket to right after
 * handshake authentication, since there is no ownership question beyond "is
 * this the caller's own identity" and therefore no scenario where the client
 * would ever need to call `room.subscribe` for it itself. No other future
 * room type belongs in this list without its own equivalent freeze. Client
 * `room.subscribe`/`room.unsubscribe` payloads name one of these six
 * strings - anything else is rejected before any authorization logic runs
 * (`UnknownRoomTypeException`).
 */
export enum RoomType {
  Organization = 'organization',
  Restaurant = 'restaurant',
  Branch = 'branch',
  Reservation = 'reservation',
  Conversation = 'conversation',
  User = 'user',
}

export function isRoomType(value: unknown): value is RoomType {
  return (
    value === RoomType.Organization ||
    value === RoomType.Restaurant ||
    value === RoomType.Branch ||
    value === RoomType.Reservation ||
    value === RoomType.Conversation ||
    value === RoomType.User
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
