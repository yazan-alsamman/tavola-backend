import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  NotificationProviderPort,
  NotificationSendParams,
  NotificationSendResult,
} from '@modules/notifications/application/ports/notification-provider.port';

/**
 * Test-only `NotificationProviderPort` implementation - never wired in
 * production (`NotificationsModule` binds `OneSignalNotificationProvider`
 * unless explicitly overridden by a test module, mirroring
 * `VerificationMessagingPort`'s own fake/real split precedent). Records
 * every call for assertions and defaults to `accepted`; tests override
 * `nextResult`/`nextResults` to exercise `noRecipients`/`retryableFailure`/
 * `permanentFailure` paths without a real OneSignal HTTP boundary.
 */
@Injectable()
export class FakeNotificationProvider implements NotificationProviderPort {
  public readonly calls: NotificationSendParams[] = [];
  private queuedResults: NotificationSendResult[] = [];

  /** Queues one-or-more results to return in order, one per call, before falling back to `accepted`. */
  queueResult(...results: NotificationSendResult[]): void {
    this.queuedResults.push(...results);
  }

  async send(params: NotificationSendParams): Promise<NotificationSendResult> {
    this.calls.push(params);
    const queued = this.queuedResults.shift();
    return queued ?? { outcome: 'accepted', providerMessageId: randomUUID() };
  }
}
