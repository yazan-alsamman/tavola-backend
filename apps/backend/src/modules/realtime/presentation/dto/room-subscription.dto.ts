export interface RoomSubscriptionRequest {
  readonly roomType: unknown;
  readonly resourceId: unknown;
}

export type RoomSubscriptionAck =
  | { readonly ok: true; readonly room: string }
  | { readonly ok: false; readonly code: string; readonly message: string };
