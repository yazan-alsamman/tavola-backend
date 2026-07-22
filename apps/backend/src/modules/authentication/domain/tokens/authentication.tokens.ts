export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
export const OPAQUE_TOKEN_SERVICE = Symbol('OPAQUE_TOKEN_SERVICE');
export const TOKEN_SERVICE = Symbol('TOKEN_SERVICE');
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
export const PASSWORD_RESET_REPOSITORY = Symbol('PASSWORD_RESET_REPOSITORY');
export const PASSWORD_HISTORY_REPOSITORY = Symbol('PASSWORD_HISTORY_REPOSITORY');
export const DEVICE_SESSION_REPOSITORY = Symbol('DEVICE_SESSION_REPOSITORY');
export const TOKEN_FAMILY_REPOSITORY = Symbol('TOKEN_FAMILY_REPOSITORY');
export const LOGIN_ATTEMPT_REPOSITORY = Symbol('LOGIN_ATTEMPT_REPOSITORY');
export const SYSTEM_CONFIGURATION = Symbol('SYSTEM_CONFIGURATION');
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
export const CLOCK = Symbol('CLOCK');
export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');
export const ID_GENERATOR = Symbol('ID_GENERATOR');
export const AUTH_REFRESH_POLICY = Symbol('AUTH_REFRESH_POLICY');
export const RATE_LIMITER = Symbol('RATE_LIMITER');
export const USER_CONSENT_REPOSITORY = Symbol('USER_CONSENT_REPOSITORY');

// ADR-022 (Phase 2.23) — Customer phone-first registration/recovery.
// VERIFICATION_MESSAGING is an application-layer port (ADR-022 Decision #5)
// and defines its own token in verification-messaging.port.ts, mirroring
// auth-token-ttl.port.ts's precedent - not centralized here with the
// domain-layer ports below.
export const OTP_SERVICE = Symbol('OTP_SERVICE');
export const PENDING_CUSTOMER_REGISTRATION_REPOSITORY = Symbol(
  'PENDING_CUSTOMER_REGISTRATION_REPOSITORY',
);
export const CUSTOMER_PASSWORD_RESET_REPOSITORY = Symbol('CUSTOMER_PASSWORD_RESET_REPOSITORY');
