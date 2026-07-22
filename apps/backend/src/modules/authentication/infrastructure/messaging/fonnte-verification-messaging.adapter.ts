import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { FonnteConfig } from '@config/fonnte.config';
import {
  VerificationMessagingPort,
  VerificationMessagingResult,
} from '../../application/ports/verification-messaging.port';

/**
 * ADR-022 §"Fonnte Integration Boundary" / AUTHENTICATION_ARCHITECTURE.md
 * §15.8. Contract re-verified live against the real Fonnte API (Phase 2.23
 * closure follow-up): `POST https://api.fonnte.com/send`, header
 * `Authorization: <token>` (no `Bearer` prefix), body `{target, countryCode,
 * message}`, target without a leading "+", success `{status:true,...}` /
 * failure `{status:false,reason:...}`.
 *
 * `countryCode` is REQUIRED, not optional - live testing found that Fonnte
 * silently assumes Indonesia (+62) for any `target` it cannot otherwise
 * disambiguate, prepending "62" to an already-correct international number
 * (e.g. Syria's `963936862035` became `62963936862035`) while still
 * reporting `status: true` ("queued") - the request "succeeds" but the
 * message is never delivered, for every non-Indonesian number. Omitting
 * `countryCode` was the original defect; it must always be sent alongside
 * `target`, derived from the same canonical `PhoneNumber` via
 * `callingCode()`, never hardcoded or independently re-parsed.
 *
 * The frozen message text (AUTHENTICATION_ARCHITECTURE.md, ADR-022
 * "WhatsApp Message") is built here, the one place allowed to see a
 * plaintext OTP immediately before it is sent - never logged, never
 * returned, never included in any thrown error.
 */
@Injectable()
export class FonnteVerificationMessagingAdapter implements VerificationMessagingPort {
  private readonly logger = new Logger(FonnteVerificationMessagingAdapter.name);
  private readonly config: FonnteConfig;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.get<FonnteConfig>('fonnte', { infer: true });
    if (!config) {
      throw new Error('Fonnte configuration is not loaded.');
    }
    this.config = config;
  }

  async sendVerificationCode(
    phone: PhoneNumber,
    code: string,
  ): Promise<VerificationMessagingResult> {
    if (!this.config.apiToken) {
      // Fails closed rather than silently "succeeding" with no real
      // delivery - never logs the token itself, only that it is absent.
      this.logger.error('FONNTE_API_TOKEN is not configured; cannot send verification code.');
      return { status: 'failed' };
    }

    const message = `your verification code to tavola is: ${code}\npowered by vegacore`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: this.config.apiToken,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          target: phone.toFonnteTarget(),
          countryCode: phone.callingCode(),
          message,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.error(`Fonnte responded with HTTP ${response.status}.`);
        return { status: 'failed' };
      }

      const body: unknown = await response.json();
      const status = (body as { status?: unknown } | null)?.status;

      if (status !== true) {
        // Never logs `body.reason` verbatim to avoid incidentally leaking
        // provider-side account/device details into logs - only that
        // delivery failed.
        this.logger.warn('Fonnte reported delivery failure (status=false).');
        return { status: 'failed' };
      }

      return { status: 'sent' };
    } catch (error) {
      this.logger.error(
        `Fonnte request failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      return { status: 'failed' };
    } finally {
      clearTimeout(timeout);
    }
  }
}
