import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { OneSignalConfig } from '@config/onesignal.config';
import { OneSignalIdentityTokenSigner } from '@shared/application/ports/onesignal-identity-token-signer.port';

/**
 * ADR-025 (amends ADR-007's Implementation Rule) - proves ownership of
 * OneSignal `external_id` (= Tavola `User.id`) to OneSignal before it
 * accepts client-SDK subscription/identity operations, closing the
 * spoofing vector ADR-025's Context section documents. Signing happens
 * exclusively on the backend, never any client (Decision #2). Contract
 * verified against OneSignal's current official Identity Verification
 * documentation (`https://documentation.onesignal.com/docs/identity-verification`,
 * checked during Phase 9 implementation):
 *
 * - Algorithm: ES256 (required).
 * - Payload: `{ iss: <OneSignal App ID>, exp: <future unix timestamp>,
 *   identity: { external_id: <the user's external_id> } }`.
 * - Consumed by the client SDK's `OneSignal.login(externalId, onesignalJWT)`
 *   call - this JWT carries no Tavola session/authorization semantics
 *   (Decision #5), only external_id ownership.
 *
 * This service is deliberately delivery-mechanism-agnostic: no REST
 * endpoint in the frozen `API_GUIDELINES.md` Notification Endpoints surface
 * exposes it (that surface is exactly the four Customer inbox endpoints -
 * see `NotificationsController`'s own doc comment), so wiring this into a
 * response (e.g. the login flow) is an explicit product/API decision this
 * phase does not make unilaterally. See the Phase 9 engineering report's
 * "Deviations" section.
 */
@Injectable()
export class OneSignalIdentityVerificationService implements OneSignalIdentityTokenSigner {
  private readonly config: OneSignalConfig;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.get<OneSignalConfig>('onesignal', { infer: true });
    if (!config) {
      throw new Error('OneSignal configuration is not loaded.');
    }
    this.config = config;
  }

  /**
   * Returns `null` (never throws, never signs with an empty/placeholder
   * key) when `ONESIGNAL_IDENTITY_VERIFICATION_PRIVATE_KEY` is not
   * configured - callers must treat that as "identity verification
   * unavailable in this environment", never fall back to an unsigned or
   * fabricated token.
   */
  sign(externalId: string): string | null {
    if (!this.config.identityVerificationPrivateKey || !this.config.appId) {
      return null;
    }

    return jwt.sign(
      { identity: { external_id: externalId } },
      this.config.identityVerificationPrivateKey,
      {
        algorithm: 'ES256',
        issuer: this.config.appId,
        expiresIn: this.config.identityVerificationExpirySeconds,
      },
    );
  }

  getExpirySeconds(): number {
    return this.config.identityVerificationExpirySeconds;
  }
}
