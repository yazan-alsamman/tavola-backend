/**
 * Shared generic result shape for every ADR-022 OTP send/resend/verify
 * step - deliberately carries no state about the underlying account/phone
 * (enumeration resistance, mirrors ForgotPasswordUseCase's existing generic
 * message convention). Never includes the OTP itself.
 */
export interface CustomerOtpResult {
  message: string;
}

export const CUSTOMER_OTP_SENT_MESSAGE =
  'If the phone number is valid, a verification code has been sent.';
export const CUSTOMER_OTP_VERIFIED_MESSAGE = 'Verification code accepted.';
