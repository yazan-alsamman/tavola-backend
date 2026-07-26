import { Inject, Injectable } from '@nestjs/common';
import {
  ONESIGNAL_IDENTITY_TOKEN_SIGNER,
  OneSignalIdentityTokenSigner,
} from '@shared/application/ports/onesignal-identity-token-signer.port';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface GetOneSignalIdentityTokenCommand {
  actor: AuthenticatedActor;
}

export interface OneSignalIdentityTokenResult {
  /**
   * The signed ES256 identity JWT, or `null` when OneSignal Identity
   * Verification is not configured in this environment. A `null` token is a
   * valid response (not an error): the client simply calls
   * `OneSignal.login(externalId)` without a JWT in that environment.
   */
  token: string | null;
  expiresInSeconds: number;
}

/**
 * ADR-025 delivery mechanism (approved 2026-07-25) - on-demand path.
 *
 * Mints the OneSignal Identity-Verification JWT for the authenticated caller
 * (`external_id = actor.userId`, per the Phase 9 freeze item 3). This is the
 * refresh path OneSignal's SDK requires: the client calls it on app-open and
 * again whenever `addUserJwtInvalidatedListener` fires, then passes the token
 * to `OneSignal.updateUserJwt`. The signer already fails closed (returns
 * `null`) when the private key is absent; no secret ever leaves the backend.
 */
@Injectable()
export class GetOneSignalIdentityTokenUseCase {
  constructor(
    @Inject(ONESIGNAL_IDENTITY_TOKEN_SIGNER)
    private readonly signer: OneSignalIdentityTokenSigner,
  ) {}

  execute(command: GetOneSignalIdentityTokenCommand): OneSignalIdentityTokenResult {
    return {
      token: this.signer.sign(command.actor.userId),
      expiresInSeconds: this.signer.getExpirySeconds(),
    };
  }
}
