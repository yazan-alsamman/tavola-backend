import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OneSignalConfig } from '@config/onesignal.config';
import {
  NotificationProviderPort,
  NotificationSendParams,
  NotificationSendResult,
} from '@modules/notifications/application/ports/notification-provider.port';

/**
 * ADR-007 (Use OneSignal Instead of Firebase) Anti-Corruption Layer - the
 * ONLY place in the codebase permitted to speak OneSignal's HTTP contract.
 * Contract verified against OneSignal's current official REST API
 * documentation (`https://documentation.onesignal.com/reference/create-notification`,
 * checked during Phase 9 implementation):
 *
 * `POST https://api.onesignal.com/notifications`, header
 * `Authorization: Key <REST API key>`, body `{ app_id, target_channel:
 * "push", include_aliases: { external_id: [userId] }, headings: { en:
 * title }, contents: { en: body }, data }`. Success is `200` with a
 * response body `id` field; `200` with NO `id` means "target audience
 * contains no valid subscriptions" (OneSignal's own documented
 * `noRecipients` case - not an error). `429` is rate-limited (retryable).
 * OneSignal's Create Notification API has no documented request-level
 * idempotency-key field (verified, not assumed) - `idempotencyKey` is
 * therefore Tavola's own internal bookkeeping only (the `Notification`
 * row's `pushIdempotencyKey` column / the BullMQ job id it derives), never
 * forwarded to OneSignal.
 *
 * Never logs the API key, and never logs the full response body verbatim
 * (mirrors `LightOtpVerificationMessagingAdapter`'s precedent) - only
 * coarse, non-sensitive failure classification.
 */
@Injectable()
export class OneSignalNotificationProvider implements NotificationProviderPort {
  private readonly logger = new Logger(OneSignalNotificationProvider.name);
  private readonly config: OneSignalConfig;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.get<OneSignalConfig>('onesignal', { infer: true });
    if (!config) {
      throw new Error('OneSignal configuration is not loaded.');
    }
    this.config = config;
  }

  async send(params: NotificationSendParams): Promise<NotificationSendResult> {
    if (!this.config.apiKey || !this.config.appId) {
      // Fails closed rather than silently "succeeding" with no real
      // delivery - never logs the key itself, only that it is absent.
      this.logger.error('ONESIGNAL_API_KEY/ONESIGNAL_APP_ID are not configured; cannot send push.');
      return { outcome: 'permanentFailure', reason: 'not_configured' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Key ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          app_id: this.config.appId,
          target_channel: 'push',
          include_aliases: { external_id: [params.userId] },
          headings: { en: params.title },
          contents: { en: params.body },
          data: params.data ?? undefined,
        }),
        signal: controller.signal,
      });

      if (response.status === 429) {
        this.logger.warn('OneSignal responded 429 (rate limited).');
        return { outcome: 'retryableFailure', reason: 'rate_limited' };
      }

      if (response.status >= 500) {
        this.logger.warn(`OneSignal responded HTTP ${response.status} (server error).`);
        return { outcome: 'retryableFailure', reason: `provider_http_${response.status}` };
      }

      if (response.status >= 400) {
        this.logger.error(`OneSignal responded HTTP ${response.status} (invalid request).`);
        return { outcome: 'permanentFailure', reason: `provider_http_${response.status}` };
      }

      const body: unknown = await response.json();
      const id = (body as { id?: unknown } | null)?.id;

      if (typeof id === 'string' && id.length > 0) {
        return { outcome: 'accepted', providerMessageId: id };
      }

      // HTTP 200 with no `id` - OneSignal's own documented "target audience
      // contains no valid subscriptions" outcome, not an error.
      return { outcome: 'noRecipients' };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      this.logger.error(
        `OneSignal request failed: ${isAbort ? 'timeout' : error instanceof Error ? error.name : 'unknown error'}`,
      );
      return { outcome: 'retryableFailure', reason: isAbort ? 'timeout' : 'network_error' };
    } finally {
      clearTimeout(timeout);
    }
  }
}
