/**
 * Explicit field allowlist - notificationOptIn/marketingOptIn only.
 * language/preferredCurrency remain part of UserProfileResult (Phase 3.1) -
 * never duplicated here - see DECISIONS.md's reconciliation note.
 */
export interface UserPreferencesResult {
  userId: string;
  notificationOptIn: boolean;
  marketingOptIn: boolean;
  updatedAt: Date;
}
