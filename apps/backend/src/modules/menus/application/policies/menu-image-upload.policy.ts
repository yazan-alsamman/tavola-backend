/** Reuses Phase 3.2/4.4's avatar/gallery precedent (no separate limit is documented for Menu images either). */
export const MENU_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;

export const MENU_IMAGE_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type MenuImageAllowedMimeType = (typeof MENU_IMAGE_ALLOWED_MIME_TYPES)[number];

export function isAllowedMenuImageMimeType(value: string): value is MenuImageAllowedMimeType {
  return (MENU_IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}
