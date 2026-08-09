import { UserProfileResult } from './user-profile.result';
import { UserPreferencesResult } from './user-preferences.result';
import { FavoriteListItemResult } from './favorite-list.result';
import { ReservationResult } from '@modules/reservations/application/dto/reservation.result';
import { ReviewResult } from '@modules/reviews/application/dto/review.result';

/**
 * GDPR right-to-portability (DOMAIN_MODEL.md "Export User Data"; ADR-014 §5:
 * "must be offered before or during the deletion flow, never only after").
 * Composed entirely from existing per-category use cases' own Result
 * shapes - no new aggregation/mapping logic duplicated here. MVP scope: one
 * page per category, capped at `EXPORT_PAGE_LIMIT` records - a documented,
 * deliberate limitation (matches `ListCurrentUserFavoritesUseCase`'s own
 * precedent for scoping a known edge case out rather than building full
 * re-paging for this minimal feature), not silently truncated data.
 */
export interface ExportUserDataResult {
  exportedAt: Date;
  profile: UserProfileResult;
  preferences: UserPreferencesResult;
  reservations: { items: ReservationResult[]; total: number };
  reviews: { items: ReviewResult[]; total: number };
  favorites: { items: FavoriteListItemResult[]; total: number };
}
