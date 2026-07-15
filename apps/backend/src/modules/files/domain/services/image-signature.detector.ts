export type DetectableImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * Detects the real image format from its magic bytes, independent of any
 * client-supplied Content-Type/extension (API_GUIDELINES.md "File Upload":
 * validate MIME type, size, extension - a declared Content-Type alone is
 * never trusted). Pure and dependency-free: no need for a file-signature
 * library for a 3-format allowlist.
 */
export function detectImageMimeType(buffer: Buffer): DetectableImageMimeType | null {
  if (isJpeg(buffer)) {
    return 'image/jpeg';
  }
  if (isPng(buffer)) {
    return 'image/png';
  }
  if (isWebp(buffer)) {
    return 'image/webp';
  }
  return null;
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer: Buffer): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => buffer[index] === byte);
}

function isWebp(buffer: Buffer): boolean {
  if (buffer.length < 12) {
    return false;
  }
  return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
}
