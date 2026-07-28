/**
 * Owner decision #15: reuses the exact MIME/size values Phase 4.4 (Restaurant
 * Gallery) established (the only precedent in this codebase), rather than
 * inventing a second, arbitrary limit.
 */
export const REVIEW_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;

export const REVIEW_IMAGE_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type ReviewImageAllowedMimeType = (typeof REVIEW_IMAGE_ALLOWED_MIME_TYPES)[number];

export function isAllowedReviewImageMimeType(value: string): value is ReviewImageAllowedMimeType {
  return (REVIEW_IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

/** Owner decision #15: maximum 5 images per Review, enforced in the
 *  application layer (no SystemConfiguration row, no feature flag). */
export const REVIEW_MAX_IMAGES_PER_REVIEW = 5;
