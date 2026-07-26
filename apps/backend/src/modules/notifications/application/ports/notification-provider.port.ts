/**
 * Phase 9 decision item 8 (frozen, ADR-007 Anti-Corruption Layer) - the
 * provider-independent contract application/domain code depends on. No
 * OneSignal-specific DTOs, HTTP status details, or SDK types may leak
 * through this interface - those belong entirely to the infrastructure
 * adapter (`OneSignalNotificationProvider`) behind it.
 */
export interface NotificationSendParams {
  /** OneSignal `external_id` = Tavola `User.id` (ADR-025) - never a `DeviceSession`/subscription identifier. */
  readonly userId: string;
  readonly title: string;
  readonly body: string;
  readonly data: Record<string, unknown> | null;
  /** Generated once, reused verbatim across every BullMQ retry (decision item 9). */
  readonly idempotencyKey: string;
}

export type NotificationSendResult =
  | { readonly outcome: 'accepted'; readonly providerMessageId: string }
  | { readonly outcome: 'noRecipients' }
  | { readonly outcome: 'retryableFailure'; readonly reason: string }
  | { readonly outcome: 'permanentFailure'; readonly reason: string };

export interface NotificationProviderPort {
  send(params: NotificationSendParams): Promise<NotificationSendResult>;
}

export const NOTIFICATION_PROVIDER = Symbol('NOTIFICATION_PROVIDER');
