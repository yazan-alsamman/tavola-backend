/**
 * ADR-025 (OneSignal Identity Verification) delivery-mechanism port.
 *
 * Cross-cutting on purpose: both the Authentication module (which attaches
 * the signed token to the Customer login / refresh responses) and the
 * Notifications module (which exposes the dedicated on-demand refresh
 * endpoint) depend on this port, never on the concrete OneSignal
 * infrastructure service. Because `NotificationsModule` already imports
 * `AuthenticationModule`, the concrete signer is bound in a small
 * `@Global()` provider module so neither feature module has to import the
 * other to reach it (same cycle-avoidance pattern `RealtimeModule` already
 * established for `EVENT_PUBLISHER`).
 */
export const ONESIGNAL_IDENTITY_TOKEN_SIGNER = Symbol('ONESIGNAL_IDENTITY_TOKEN_SIGNER');

export interface OneSignalIdentityTokenSigner {
  /**
   * Signs a short-lived ES256 JWT proving ownership of `externalId`
   * (= Tavola `User.id`) to OneSignal. Returns `null` when Identity
   * Verification is not configured in this environment
   * (`ONESIGNAL_IDENTITY_VERIFICATION_PRIVATE_KEY` / `ONESIGNAL_APP_ID`
   * absent) - callers must treat `null` as "identity verification
   * unavailable", never fabricate or fall back to an unsigned token.
   */
  sign(externalId: string): string | null;

  /**
   * The configured token lifetime in seconds, so a client knows when to
   * proactively re-fetch (in addition to reacting to OneSignal's own
   * JWT-invalidation event).
   */
  getExpirySeconds(): number;
}
