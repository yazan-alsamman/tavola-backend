/**
 * Explicit field allowlist - deliberately excludes passwordHash, status,
 * emailVerified, failedLoginCount, lockedUntil, permissionsVersion,
 * sessionVersion, and every other Authentication-owned field never intended
 * to leave the Authentication bounded context via a User Module response.
 */
export interface UserProfileResult {
  userId: string;
  // ADR-022 (Phase 2.23): nullable — a Customer (phone-first, no name/email
  // collected at registration) can now reach this actor-agnostic endpoint
  // too, not only Restaurant Owner/staff.
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  language: string;
  preferredCurrency: string | null;
  createdAt: Date;
  updatedAt: Date;
}
