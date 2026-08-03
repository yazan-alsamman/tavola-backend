/**
 * DECISIONS.md D7 - reuses the exact MIME/size precedent
 * `REVIEW_IMAGE_MAX_SIZE_BYTES`/`REVIEW_IMAGE_ALLOWED_MIME_TYPES` already
 * established (Phase 4.4 Restaurant Gallery), rather than inventing a
 * second, arbitrary limit. Images only in this phase - no virus scanning
 * (explicit non-goal), and no document/PDF support yet (not requested by
 * ADR-020's own "Attachments" decision item, which only names `Files` +
 * `attachmentFileId`, not a file-type list).
 */
export const MESSAGE_ATTACHMENT_MAX_SIZE_BYTES = 5 * 1024 * 1024;

export const MESSAGE_ATTACHMENT_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type MessageAttachmentAllowedMimeType =
  (typeof MESSAGE_ATTACHMENT_ALLOWED_MIME_TYPES)[number];

export function isAllowedMessageAttachmentMimeType(
  value: string,
): value is MessageAttachmentAllowedMimeType {
  return (MESSAGE_ATTACHMENT_ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

export const MESSAGE_ATTACHMENT_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
