/**
 * Conservative minimal policy - no explicit size/MIME limit is documented
 * anywhere in /docs for avatars (API_GUIDELINES.md's "File Upload" section
 * only requires that MIME/size/extension be validated, not specific
 * values), so this is a deliberate implementation judgment call, recorded
 * here as the single source of truth referenced by both the multer
 * interceptor limit and the use case's own authoritative check.
 */
export const AVATAR_MAX_SIZE_BYTES = 5 * 1024 * 1024;

export const AVATAR_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AvatarAllowedMimeType = (typeof AVATAR_ALLOWED_MIME_TYPES)[number];

export function isAllowedAvatarMimeType(value: string): value is AvatarAllowedMimeType {
  return (AVATAR_ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}
