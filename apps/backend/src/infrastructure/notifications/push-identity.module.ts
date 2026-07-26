import { Global, Module } from '@nestjs/common';
import { ONESIGNAL_IDENTITY_TOKEN_SIGNER } from '@shared/application/ports/onesignal-identity-token-signer.port';
import { OneSignalIdentityVerificationService } from './providers/onesignal/onesignal-identity-verification.service';

/**
 * ADR-025 delivery mechanism (approved 2026-07-25). Binds the OneSignal
 * Identity-Verification signer behind the `ONESIGNAL_IDENTITY_TOKEN_SIGNER`
 * port and makes it ambiently available to BOTH the Authentication module
 * (attaches the token to the Customer login / refresh responses) and the
 * Notifications module (dedicated on-demand refresh endpoint) without either
 * feature module importing the other - identical `@Global()` cycle-avoidance
 * to `RealtimeModule`'s `EVENT_PUBLISHER` binding. Depends only on the global
 * `ConfigService` (no persistence, no other module), so it is safe to load
 * this early. The signer fails closed (returns `null`) when
 * `ONESIGNAL_IDENTITY_VERIFICATION_PRIVATE_KEY`/`ONESIGNAL_APP_ID` are absent.
 */
@Global()
@Module({
  providers: [
    OneSignalIdentityVerificationService,
    {
      provide: ONESIGNAL_IDENTITY_TOKEN_SIGNER,
      useExisting: OneSignalIdentityVerificationService,
    },
  ],
  exports: [ONESIGNAL_IDENTITY_TOKEN_SIGNER],
})
export class PushIdentityModule {}
