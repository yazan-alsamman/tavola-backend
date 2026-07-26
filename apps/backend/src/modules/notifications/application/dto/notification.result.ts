/**
 * API_GUIDELINES.md's frozen Notification Endpoints response contract -
 * deliberately excludes every `push*` internal delivery-tracking field
 * (`pushStatus`, `pushSentAt`, `pushFailedAt`, `pushFailureReason`,
 * `pushIdempotencyKey`, `pushProviderMessageId`), which are never part of
 * the client-facing contract.
 */
export interface NotificationResult {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read: boolean;
  readAt: Date | null;
  createdAt: Date;
}
