/**
 * Explicit field allowlist - deliberately excludes passwordHash, status,
 * emailVerified, failedLoginCount, lockedUntil, permissionsVersion,
 * sessionVersion, and every other Authentication-owned field never intended
 * to leave the Authentication bounded context via a User Module response.
 */
export interface UserProfileResult {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  language: string;
  preferredCurrency: string | null;
  createdAt: Date;
  updatedAt: Date;
}
