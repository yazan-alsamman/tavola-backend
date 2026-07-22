import { User } from '../entities/user.entity';
import { DeviceSession } from '../entities/device-session.entity';
import { TokenFamily } from '../entities/token-family.entity';
import { Email } from '@shared/domain/value-objects/email.vo';
import { RefreshTokenHash } from '@shared/domain/value-objects/refresh-token-hash.vo';
import { UserId, SessionId, TokenFamilyId } from '@shared/domain/value-objects/identifiers.vo';
import { SessionRevokeReason } from '../enums/authentication.enums';

export type RotateRefreshTokenOutcome =
  { status: 'rotated'; sessionId: string } | { status: 'hash_mismatch' };

export interface LoginAttemptRecord {
  id: string;
  identifier: string;
  ipAddress: string;
  success: boolean;
  failureReason: string | null;
  createdAt: Date;
}

export interface PasswordHistoryRecord {
  id: string;
  userId: string;
  passwordHash: string;
  createdAt: Date;
}

export interface PasswordResetTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export type RevokeSessionOutcome =
  { status: 'revoked' } | { status: 'already_revoked' } | { status: 'not_found_or_not_owned' };

export type UpdatePasswordIfCurrentHashMatchesOutcome =
  { status: 'updated'; sessionVersion: number } | { status: 'hash_mismatch' };

export interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  existsByEmail(email: Email): Promise<boolean>;
  /** ADR-022 (Phase 2.23): Customer login/lookup by canonical E.164 phone. */
  findByPhone(phone: string): Promise<User | null>;
  existsByPhone(phone: string): Promise<boolean>;
  existsByUsername(username: string): Promise<boolean>;
  save(user: User): Promise<void>;
  incrementSessionVersion(userId: UserId, at: Date): Promise<number | null>;
  updatePasswordIfCurrentHashMatches(input: {
    userId: UserId;
    expectedCurrentHash: string;
    newHash: string;
    at: Date;
  }): Promise<UpdatePasswordIfCurrentHashMatchesOutcome>;
  /**
   * Narrow avatar-pointer accessors (Phase 3.2), deliberately bypassing the
   * User aggregate's save()/mapper round-trip - `avatarId` is not part of
   * `UserProps` today, and adding it there would touch verified Phase 3.1
   * domain code for no benefit (avatar state is otherwise independent of the
   * profile-editing invariants `updateProfile()` owns). Mirrors the existing
   * `incrementSessionVersion` precedent: a single-column read/write path
   * alongside the full aggregate `save()`.
   */
  getAvatarId(userId: UserId): Promise<string | null>;
  updateAvatarId(userId: UserId, avatarId: string | null, at: Date): Promise<void>;
}

export interface DeviceSessionRepository {
  findById(id: SessionId): Promise<DeviceSession | null>;
  findByRefreshTokenHash(hash: RefreshTokenHash): Promise<DeviceSession | null>;
  findByPreviousRefreshTokenHash(hash: RefreshTokenHash): Promise<DeviceSession | null>;
  countActiveByUserId(userId: UserId, now: Date): Promise<number>;
  findActiveByUserId(userId: UserId, now: Date): Promise<DeviceSession[]>;
  save(session: DeviceSession): Promise<void>;
  rotateRefreshTokenIfHashMatches(input: {
    presentedHash: string;
    newHash: string;
    now: Date;
    expiresAt: Date;
    permissionsVersion: number;
  }): Promise<RotateRefreshTokenOutcome>;
  revokeAllByUserId(userId: UserId, at: Date, reason: string): Promise<void>;
  revokeAllByUserIdExceptSession(input: {
    userId: UserId;
    exceptSessionId: SessionId;
    at: Date;
    reason: SessionRevokeReason;
  }): Promise<string[]>;
  updateSessionVersionIfActive(input: {
    sessionId: SessionId;
    userId: UserId;
    sessionVersion: number;
    at: Date;
  }): Promise<boolean>;
  revokeAllByTokenFamilyId(
    tokenFamilyId: TokenFamilyId,
    at: Date,
    reason: SessionRevokeReason,
  ): Promise<void>;
  revokeByIdIfOwnedByUser(input: {
    sessionId: SessionId;
    userId: UserId;
    at: Date;
    reason: SessionRevokeReason;
  }): Promise<RevokeSessionOutcome>;
}

export interface TokenFamilyRepository {
  findById(id: TokenFamilyId): Promise<TokenFamily | null>;
  save(family: TokenFamily): Promise<void>;
  revokeAllByUserId(userId: UserId, at: Date): Promise<void>;
  revokeAllByUserIdExceptFamily(input: {
    userId: UserId;
    exceptTokenFamilyId: TokenFamilyId;
    at: Date;
  }): Promise<void>;
  markCompromisedIfActive(id: TokenFamilyId, at: Date): Promise<boolean>;
}

export interface LoginAttemptRepository {
  save(record: LoginAttemptRecord): Promise<void>;
}

export interface PasswordHistoryRepository {
  findRecentByUserId(userId: UserId, limit: number): Promise<PasswordHistoryRecord[]>;
  save(record: PasswordHistoryRecord): Promise<void>;
  pruneBeyondLimit(userId: UserId, keep: number): Promise<void>;
}

export interface PasswordResetRepository {
  findByTokenHash(tokenHash: string): Promise<PasswordResetTokenRecord | null>;
  save(record: PasswordResetTokenRecord): Promise<void>;
  invalidateActiveByUserId(userId: UserId): Promise<void>;
  consumeIfActive(id: string, consumedAt: Date): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// ADR-022 (Phase 2.23) — Customer phone-first registration & recovery
// ---------------------------------------------------------------------------

export interface PendingCustomerRegistrationRecord {
  id: string;
  username: string;
  phone: string;
  codeHash: string;
  codeExpiresAt: Date;
  incorrectAttemptCount: number;
  verifiedAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PendingCustomerRegistrationRepository {
  findByPhone(phone: string): Promise<PendingCustomerRegistrationRecord | null>;
  findById(id: string): Promise<PendingCustomerRegistrationRecord | null>;
  /**
   * ADR-022 Decision #18 (repeated START / concurrency): atomically inserts
   * a fresh pending registration for `phone`, or - if an active one already
   * exists - overwrites its username/codeHash/codeExpiresAt and resets
   * incorrectAttemptCount/verifiedAt, all in a single database statement
   * (a Prisma `upsert` keyed on the unique `phone` column). Two concurrent
   * callers for the same phone race on the database's own unique
   * constraint, not application-level locking, so exactly one active row
   * can ever exist per phone. Throws `UsernameAlreadyExistsException` if
   * `username` collides with a *different* phone's active registration
   * (translated from the table's own unique-on-username constraint).
   */
  upsertActive(input: {
    username: string;
    phone: string;
    codeHash: string;
    codeExpiresAt: Date;
    now: Date;
  }): Promise<PendingCustomerRegistrationRecord>;
  incrementAttemptCount(id: string): Promise<void>;
  markVerified(id: string, at: Date): Promise<void>;
  /** Atomic conditional consume - only the first caller for a given id can succeed. */
  consumeIfVerifiedAndUnconsumed(
    id: string,
    at: Date,
  ): Promise<PendingCustomerRegistrationRecord | null>;
  /** Frees the phone/username slot once promoted into a real User (ADR-022: pending registrations are not retained after COMPLETE, unlike EmailVerificationToken's forever-kept consumed rows - phone is a reusable, non-random unique key here, so the row must not permanently occupy it). */
  deleteById(id: string): Promise<void>;
  existsByUsername(username: string): Promise<boolean>;
  existsByPhone(phone: string): Promise<boolean>;
}

export interface CustomerPasswordResetTokenRecord {
  id: string;
  userId: string;
  codeHash: string;
  codeExpiresAt: Date;
  incorrectAttemptCount: number;
  verifiedAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerPasswordResetRepository {
  findActiveByUserId(userId: UserId, now: Date): Promise<CustomerPasswordResetTokenRecord | null>;
  save(record: CustomerPasswordResetTokenRecord): Promise<void>;
  invalidateActiveByUserId(userId: UserId): Promise<void>;
  incrementAttemptCount(id: string): Promise<void>;
  markVerified(id: string, at: Date): Promise<void>;
  consumeIfVerifiedAndUnconsumed(
    id: string,
    at: Date,
  ): Promise<CustomerPasswordResetTokenRecord | null>;
}
