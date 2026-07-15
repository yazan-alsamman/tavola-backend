/**
 * Generates opaque tokens (refresh, email verification, password reset)
 * and produces SHA-256 digests for storage at rest (DATABASE_SCHEMA.md).
 */
export interface OpaqueTokenService {
  generate(): string;
  hash(token: string): string;
  verify(token: string, storedHash: string): boolean;
}
