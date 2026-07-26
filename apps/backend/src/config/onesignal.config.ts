import { registerAs } from '@nestjs/config';

/**
 * ADR-007 (Use OneSignal Instead of Firebase) / ADR-025 (OneSignal Identity
 * Verification). `apiKey`/`identityVerificationPrivateKey` are server-side
 * secrets, read only from environment configuration - never hardcoded,
 * logged, or returned by any API response, mirroring `lightotp.config.ts`'s
 * precedent exactly. Both default to `''` (never `.required()`) so the
 * application still boots in environments without real OneSignal
 * credentials configured (tests, local dev without a live provider) - the
 * adapter itself fails closed (never silently "succeeds") when unconfigured.
 */
export default registerAs('onesignal', () => ({
  appId: process.env.ONESIGNAL_APP_ID ?? '',
  apiKey: process.env.ONESIGNAL_API_KEY ?? '',
  apiUrl: process.env.ONESIGNAL_API_URL ?? 'https://api.onesignal.com/notifications',
  requestTimeoutMs: parseInt(process.env.ONESIGNAL_REQUEST_TIMEOUT_MS ?? '10000', 10),
  identityVerificationPrivateKey: process.env.ONESIGNAL_IDENTITY_VERIFICATION_PRIVATE_KEY ?? '',
  identityVerificationExpirySeconds: parseInt(
    process.env.ONESIGNAL_IDENTITY_VERIFICATION_EXPIRY_SECONDS ?? '3600',
    10,
  ),
}));

export interface OneSignalConfig {
  appId: string;
  apiKey: string;
  apiUrl: string;
  requestTimeoutMs: number;
  identityVerificationPrivateKey: string;
  identityVerificationExpirySeconds: number;
}
