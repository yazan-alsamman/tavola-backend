import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { LightOtpConfig } from '@config/lightotp.config';
import {
  VerificationMessagingPort,
  VerificationMessagingResult,
} from '../../application/ports/verification-messaging.port';

/**
 * ADR-024 (supersedes ADR-022's Fonnte Integration Boundary) /
 * AUTHENTICATION_ARCHITECTURE.md §15.8. Contract verified against LightOTP's
 * official documentation (`https://lightotp.com/docs`): `POST
 * https://api.lightotp.com/SendMessage`, header `X-Api-Key: <key>`, body
 * `{otpCode, toPhoneE164, idempotencyKey}`, success `{id, messageStatus}` /
 * failure `{errorMessage}`.
 *
 * `toPhoneE164` requires the full canonical E.164 value **with** its
 * leading "+" (the opposite of Fonnte's stripped-"+" `target` field) -
 * `PhoneNumber.value` already is that value; no boundary conversion is
 * needed here, unlike the retired Fonnte adapter's `toFonnteTarget()`.
 *
 * LightOTP's API accepts no free-text message/template field at all - the
 * WhatsApp message content is entirely provider/account-managed (selected
 * only by an optional `languageCode`, omitted here since no per-call
 * customer-language input exists on this port's signature). The previously
 * approved "your verification code to tavola is: {CODE}" text can therefore
 * no longer be sent as application-controlled copy; this is a mechanical
 * consequence of LightOTP's real API shape, not a product decision made
 * here - see ADR-024's "Message/Template Contract" note.
 *
 * `idempotencyKey` is a fresh UUID per call, per LightOTP's own documented
 * "safe retry semantics" recommendation - this call has no internal retry
 * loop today, but the key costs nothing to include and protects against a
 * duplicate send if a caller/network layer above this adapter ever retries.
 */
@Injectable()
export class LightOtpVerificationMessagingAdapter implements VerificationMessagingPort {
  private readonly logger = new Logger(LightOtpVerificationMessagingAdapter.name);
  private readonly config: LightOtpConfig;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.get<LightOtpConfig>('lightotp', { infer: true });
    if (!config) {
      throw new Error('LightOTP configuration is not loaded.');
    }
    this.config = config;
  }

  async sendVerificationCode(
    phone: PhoneNumber,
    code: string,
  ): Promise<VerificationMessagingResult> {
    if (!this.config.apiKey) {
      // Fails closed rather than silently "succeeding" with no real
      // delivery - never logs the key itself, only that it is absent.
      this.logger.error('LIGHTOTP_API_KEY is not configured; cannot send verification code.');
      return { status: 'failed' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: {
          'X-Api-Key': this.config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          otpCode: code,
          toPhoneE164: phone.value,
          idempotencyKey: randomUUID(),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.error(`LightOTP responded with HTTP ${response.status}.`);
        return { status: 'failed' };
      }

      const body: unknown = await response.json();
      const messageStatus = (body as { messageStatus?: unknown } | null)?.messageStatus;

      if (messageStatus === 'Failed' || messageStatus === 'Deleted') {
        // Never logs `body.errorMessage`/full response verbatim, to avoid
        // incidentally leaking provider-side account details into logs -
        // only that delivery failed.
        this.logger.warn(`LightOTP reported delivery failure (messageStatus=${messageStatus}).`);
        return { status: 'failed' };
      }

      if (typeof messageStatus !== 'string') {
        this.logger.error('LightOTP returned a malformed response (missing messageStatus).');
        return { status: 'failed' };
      }

      return { status: 'sent' };
    } catch (error) {
      this.logger.error(
        `LightOTP request failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      return { status: 'failed' };
    } finally {
      clearTimeout(timeout);
    }
  }
}
