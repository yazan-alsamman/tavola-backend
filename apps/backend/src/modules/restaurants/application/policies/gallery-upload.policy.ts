/**
 * No separate size/MIME limit is documented anywhere in /docs for restaurant
 * gallery images either (same gap as avatars, API_GUIDELINES.md's "File
 * Upload" section only requires that MIME/size/extension be validated, not
 * specific values) - reusing the exact values Phase 3.2 established for
 * avatars, the only precedent in this codebase, rather than inventing a
 * second, arbitrary limit.
 */
export const GALLERY_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;

export const GALLERY_IMAGE_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type GalleryImageAllowedMimeType = (typeof GALLERY_IMAGE_ALLOWED_MIME_TYPES)[number];

export function isAllowedGalleryImageMimeType(value: string): value is GalleryImageAllowedMimeType {
  return (GALLERY_IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

/** Approved architecture decision: 20 images per restaurant, enforced in the
 * application layer (no SystemConfiguration row, no feature flag). */
export const GALLERY_MAX_IMAGES_PER_RESTAURANT = 20;
