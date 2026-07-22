import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * The public-facing shape of every `VerificationMessagingResult.status ===
 * 'failed'` case (ADR-022 §"Fonnte Integration Boundary") - never carries
 * the provider's raw reason, error string, status code, or token; those are
 * infrastructure-layer logging concerns only.
 */
export class VerificationMessagingFailedException extends DomainException {
  public readonly code = 'AUTH_VERIFICATION_DELIVERY_FAILED';

  constructor() {
    super('Unable to send the verification code. Please try again shortly.', 503);
  }
}
