import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';

/**
 * ADR-022 Decision #5 / #17, provider updated by ADR-024: `Application ->
 * VerificationMessagingPort -> LightOtpVerificationMessagingAdapter ->
 * LightOTP HTTP API`. Domain/application code depends only on this
 * interface - never on the provider's HTTP payloads, response shapes,
 * status codes, error strings, or the API key.
 *
 * A closed result type, not a passthrough of the provider's raw response
 * (mirrors `RotateRefreshTokenOutcome`'s existing closed-union precedent in
 * `authentication.repositories.ts`) - every provider failure mode (network
 * failure, timeout, invalid/expired token, disconnected device, quota,
 * invalid target, status=false, malformed response) collapses to `'failed'`
 * here; the specific reason is for infrastructure-layer logging only and
 * must never reach the public API (AUTHENTICATION_ARCHITECTURE.md §15.8).
 */
export type VerificationMessagingResult = { status: 'sent' } | { status: 'failed' };

export interface VerificationMessagingPort {
  sendVerificationCode(phone: PhoneNumber, code: string): Promise<VerificationMessagingResult>;
}

export const VERIFICATION_MESSAGING = Symbol('VERIFICATION_MESSAGING');
