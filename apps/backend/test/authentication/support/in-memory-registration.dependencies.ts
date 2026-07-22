import { randomUUID } from 'crypto';
import { User } from '@modules/authentication/domain/entities/user.entity';
import { UserConsent } from '@modules/authentication/domain/entities/user-consent.entity';
import { Organization } from '@modules/organizations/domain/entities/organization.entity';
import { OrganizationMember } from '@modules/organizations/domain/entities/organization-member.entity';
import { UserConsentRepository } from '@modules/authentication/domain/repositories/user-consent.repository';
import { EmailAlreadyExistsException } from '@modules/authentication/domain/exceptions/email-already-exists.exception';
import { PhoneAlreadyExistsException } from '@modules/authentication/domain/exceptions/phone-already-exists.exception';
import { UsernameAlreadyExistsException } from '@modules/authentication/domain/exceptions/username-already-exists.exception';
import {
  DeviceSessionRepository,
  LoginAttemptRecord,
  LoginAttemptRepository,
  PasswordHistoryRecord,
  PasswordHistoryRepository,
  PasswordResetRepository,
  PasswordResetTokenRecord,
  PendingCustomerRegistrationRecord,
  PendingCustomerRegistrationRepository,
  CustomerPasswordResetTokenRecord,
  CustomerPasswordResetRepository,
  RotateRefreshTokenOutcome,
  RevokeSessionOutcome,
  TokenFamilyRepository,
  UpdatePasswordIfCurrentHashMatchesOutcome,
  UserRepository,
} from '@modules/authentication/domain/repositories/authentication.repositories';
import { OtpService } from '@modules/authentication/domain/services/otp.port';
import {
  VerificationMessagingPort,
  VerificationMessagingResult,
} from '@modules/authentication/application/ports/verification-messaging.port';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { SessionRevokeReason } from '@modules/authentication/domain/enums/authentication.enums';
import { DeviceSession } from '@modules/authentication/domain/entities/device-session.entity';
import { TokenFamily } from '@modules/authentication/domain/entities/token-family.entity';
import {
  LoginOrganizationReaderPort,
  LoginOrganizationSnapshot,
} from '@modules/authentication/application/ports/login-organization-reader.port';
import {
  EmployeeAccessResolverPort,
  EmployeeAccessSnapshot,
} from '@modules/authentication/application/ports/employee-access-resolver.port';
import { AuditLogEntry, AuditLogWriterPort } from '@shared/application/ports/audit-log-writer.port';
import { AuthTokenTtlPort } from '@modules/authentication/application/ports/auth-token-ttl.port';
import { AuthRefreshPolicyPort } from '@modules/authentication/application/ports/auth-refresh-policy.port';
import { TokenService } from '@modules/authentication/domain/services/token-service.port';
import {
  AccessTokenActorType,
  AccessTokenClaims,
} from '@modules/authentication/domain/services/access-token-claims';
import { RefreshTokenHash } from '@shared/domain/value-objects/refresh-token-hash.vo';
import { SessionId, TokenFamilyId } from '@shared/domain/value-objects/identifiers.vo';
import {
  OrganizationMemberRepository,
  OrganizationRepository,
} from '@modules/organizations/domain/repositories/organization.repository';
import { Email } from '@shared/domain/value-objects/email.vo';
import { OrganizationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { OrganizationSlug } from '@shared/domain/value-objects/organization-slug.vo';
import { Password } from '@shared/domain/value-objects/password.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { PasswordHasher } from '@modules/authentication/domain/services/password-hasher.port';
import { OpaqueTokenService } from '@modules/authentication/domain/services/opaque-token.port';
import { ClockPort } from '@shared/application/ports/clock.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { SystemConfigurationPort } from '@shared/application/ports/system-configuration.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import {
  TenantBootstrapContext,
  TenantContextPort,
} from '@shared/application/ports/tenant-context.port';
import { DomainEvent } from '@shared/domain/base/domain-event.base';

export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, User>();
  private readonly avatarIds = new Map<string, string | null>();

  async findById(id: UserId): Promise<User | null> {
    return this.users.get(id.value) ?? null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email?.value === email.value) {
        return user;
      }
    }
    return null;
  }

  async existsByEmail(email: Email): Promise<boolean> {
    return (await this.findByEmail(email)) !== null;
  }

  /** ADR-022 (Phase 2.23): Customer login/lookup by canonical E.164 phone. */
  async findByPhone(phone: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.phone === phone) {
        return user;
      }
    }
    return null;
  }

  async existsByPhone(phone: string): Promise<boolean> {
    return (await this.findByPhone(phone)) !== null;
  }

  async existsByUsername(username: string): Promise<boolean> {
    for (const user of this.users.values()) {
      if (user.username === username) {
        return true;
      }
    }
    return false;
  }

  async save(user: User): Promise<void> {
    for (const existing of this.users.values()) {
      if (existing.userId.value === user.userId.value) {
        continue;
      }
      // Mirrors the real Prisma repository's unique-constraint violations
      // (see PrismaUserRepository.save), so unit tests exercise the same
      // race-safety contract without a real database.
      if (user.email !== null && existing.email?.value === user.email.value) {
        throw new EmailAlreadyExistsException(user.email.value);
      }
      if (user.phone !== null && existing.phone === user.phone) {
        throw new PhoneAlreadyExistsException();
      }
      if (user.username !== null && existing.username === user.username) {
        throw new UsernameAlreadyExistsException();
      }
    }
    this.users.set(user.userId.value, user);
  }

  async incrementSessionVersion(userId: UserId, at: Date): Promise<number | null> {
    const user = this.users.get(userId.value);
    if (!user) {
      return null;
    }
    const bumped = user.bumpSessionVersion();
    const withTimestamp = User.reconstitute({
      ...bumped.toProps(),
      updatedAt: at,
    });
    this.users.set(userId.value, withTimestamp);
    return withTimestamp.sessionVersion;
  }

  async updatePasswordIfCurrentHashMatches(input: {
    userId: UserId;
    expectedCurrentHash: string;
    newHash: string;
    at: Date;
  }): Promise<UpdatePasswordIfCurrentHashMatchesOutcome> {
    const user = this.users.get(input.userId.value);
    if (!user || user.passwordHash.value !== input.expectedCurrentHash) {
      return { status: 'hash_mismatch' };
    }

    const updated = user.completePasswordChange(PasswordHash.create(input.newHash), input.at);
    this.users.set(input.userId.value, updated);
    return { status: 'updated', sessionVersion: updated.sessionVersion };
  }

  async getAvatarId(userId: UserId): Promise<string | null> {
    return this.avatarIds.get(userId.value) ?? null;
  }

  async updateAvatarId(userId: UserId, avatarId: string | null, _at: Date): Promise<void> {
    this.avatarIds.set(userId.value, avatarId);
  }

  snapshot(): User[] {
    return [...this.users.values()];
  }

  restore(users: User[]): void {
    this.users.clear();
    for (const user of users) {
      this.users.set(user.userId.value, user);
    }
  }
}

export class InMemoryOrganizationRepository implements OrganizationRepository {
  private readonly organizations = new Map<string, Organization>();

  async findById(id: OrganizationId): Promise<Organization | null> {
    return this.organizations.get(id.value) ?? null;
  }

  async findBySlug(slug: OrganizationSlug): Promise<Organization | null> {
    for (const organization of this.organizations.values()) {
      if (organization.slug.value === slug.value) {
        return organization;
      }
    }
    return null;
  }

  async save(organization: Organization): Promise<void> {
    this.organizations.set(organization.organizationId.value, organization);
  }

  snapshot(): Organization[] {
    return [...this.organizations.values()];
  }

  restore(organizations: Organization[]): void {
    this.organizations.clear();
    for (const organization of organizations) {
      this.organizations.set(organization.organizationId.value, organization);
    }
  }
}

export class InMemoryOrganizationMemberRepository implements OrganizationMemberRepository {
  private readonly members = new Map<string, OrganizationMember>();

  async findByOrganizationAndUser(
    organizationId: OrganizationId,
    userId: UserId,
  ): Promise<OrganizationMember | null> {
    for (const member of this.members.values()) {
      if (
        member.organizationId.value === organizationId.value &&
        member.userId.value === userId.value
      ) {
        return member;
      }
    }
    return null;
  }

  async countActiveOwners(organizationId: OrganizationId): Promise<number> {
    let count = 0;
    for (const member of this.members.values()) {
      if (member.organizationId.value === organizationId.value && member.isOwner()) {
        count += 1;
      }
    }
    return count;
  }

  async save(member: OrganizationMember): Promise<void> {
    this.members.set(member.toProps().id, member);
  }

  snapshot(): OrganizationMember[] {
    return [...this.members.values()];
  }

  restore(members: OrganizationMember[]): void {
    this.members.clear();
    for (const member of members) {
      this.members.set(member.toProps().id, member);
    }
  }
}

export class InMemoryPasswordResetRepository implements PasswordResetRepository {
  readonly tokens: PasswordResetTokenRecord[] = [];

  async findByTokenHash(tokenHash: string): Promise<PasswordResetTokenRecord | null> {
    return this.tokens.find((token) => token.tokenHash === tokenHash) ?? null;
  }

  async save(record: PasswordResetTokenRecord): Promise<void> {
    const index = this.tokens.findIndex((token) => token.id === record.id);
    if (index >= 0) {
      this.tokens[index] = { ...record };
      return;
    }
    this.tokens.push({ ...record });
  }

  async invalidateActiveByUserId(userId: UserId): Promise<void> {
    const now = new Date();
    for (const token of this.tokens) {
      if (token.userId === userId.value && token.consumedAt === null) {
        token.consumedAt = now;
      }
    }
  }

  async consumeIfActive(id: string, consumedAt: Date): Promise<boolean> {
    const token = this.tokens.find((entry) => entry.id === id);
    if (!token || token.consumedAt !== null || token.expiresAt <= consumedAt) {
      return false;
    }
    token.consumedAt = consumedAt;
    return true;
  }
}

export class InMemoryPasswordHistoryRepository implements PasswordHistoryRepository {
  readonly history: PasswordHistoryRecord[] = [];

  async findRecentByUserId(userId: UserId, limit: number): Promise<PasswordHistoryRecord[]> {
    return this.history
      .filter((entry) => entry.userId === userId.value)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async save(record: PasswordHistoryRecord): Promise<void> {
    this.history.push({ ...record });
  }

  async pruneBeyondLimit(userId: UserId, keep: number): Promise<void> {
    const entries = this.history
      .filter((entry) => entry.userId === userId.value)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const idsToRemove = new Set(entries.slice(keep).map((entry) => entry.id));
    for (let index = this.history.length - 1; index >= 0; index -= 1) {
      if (idsToRemove.has(this.history[index].id)) {
        this.history.splice(index, 1);
      }
    }
  }
}

export class InMemoryUserConsentRepository implements UserConsentRepository {
  readonly consents: UserConsent[] = [];

  async saveMany(consents: UserConsent[]): Promise<void> {
    this.consents.push(...consents);
  }

  restore(consents: UserConsent[]): void {
    this.consents.length = 0;
    this.consents.push(...consents);
  }
}

export class FakePasswordHasher implements PasswordHasher {
  async hash(password: Password): Promise<PasswordHash> {
    return PasswordHash.create(`argon2id$fake$${password.value}`);
  }

  async verify(password: Password, hash: PasswordHash): Promise<boolean> {
    return hash.value === `argon2id$fake$${password.value}`;
  }
}

export class FakeOpaqueTokenService implements OpaqueTokenService {
  private counter = 0;

  generate(): string {
    this.counter += 1;
    return `opaque-token-${this.counter}`;
  }

  hash(token: string): string {
    return `sha256-${token}`;
  }

  verify(token: string, storedHash: string): boolean {
    return this.hash(token) === storedHash;
  }
}

export class FixedClock implements ClockPort {
  constructor(private readonly fixed: Date) {}

  now(): Date {
    return new Date(this.fixed.getTime());
  }
}

export class UuidGenerator implements IdGeneratorPort {
  generate(): string {
    return randomUUID();
  }
}

export class SequentialIdGenerator implements IdGeneratorPort {
  constructor(private readonly ids: string[]) {
    if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
      throw new Error('SequentialIdGenerator requires valid UUID strings.');
    }
  }

  private index = 0;

  generate(): string {
    const id = this.ids[this.index];
    if (id === undefined) {
      throw new Error('SequentialIdGenerator exhausted.');
    }
    this.index += 1;
    return id;
  }
}

export class InMemorySystemConfiguration implements SystemConfigurationPort {
  constructor(private readonly values: Record<string, string | number> = {}) {}

  async getNumber(key: string, defaultValue: number): Promise<number> {
    const value = this.values[key];
    return typeof value === 'number' ? value : defaultValue;
  }

  async getString(key: string, defaultValue: string): Promise<string> {
    const value = this.values[key];
    return typeof value === 'string' ? value : defaultValue;
  }
}

export class CollectingEventPublisher implements EventPublisherPort {
  readonly events: DomainEvent[] = [];

  async publish(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }

  async publishAll(events: DomainEvent[]): Promise<void> {
    this.events.push(...events);
  }
}

export class CollectingAuditLogWriter implements AuditLogWriterPort {
  readonly entries: AuditLogEntry[] = [];

  async record(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
}

export class ImmediateUnitOfWork implements UnitOfWorkPort {
  async execute<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

export class RollingBackUnitOfWork implements UnitOfWorkPort {
  async execute<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw error;
    }
  }
}

/**
 * Records every bound context (so tests can assert what tenant identity the
 * use case established) without any real AsyncLocalStorage machinery -
 * `work()` just runs immediately, matching `ImmediateUnitOfWork`'s style.
 */
export class RecordingTenantContextPort implements TenantContextPort {
  readonly boundContexts: TenantBootstrapContext[] = [];

  async runAsync<T>(context: TenantBootstrapContext, work: () => Promise<T>): Promise<T> {
    this.boundContexts.push(context);
    return work();
  }
}

export class InMemoryDeviceSessionRepository implements DeviceSessionRepository {
  readonly sessions: DeviceSession[] = [];

  async findById(id: SessionId): Promise<DeviceSession | null> {
    return this.sessions.find((session) => session.sessionId.value === id.value) ?? null;
  }

  async findByRefreshTokenHash(hash: RefreshTokenHash): Promise<DeviceSession | null> {
    return this.sessions.find((session) => session.refreshTokenHash.value === hash.value) ?? null;
  }

  async findByPreviousRefreshTokenHash(hash: RefreshTokenHash): Promise<DeviceSession | null> {
    return (
      this.sessions.find((session) => session.toProps().previousRefreshTokenHash === hash.value) ??
      null
    );
  }

  async countActiveByUserId(userId: UserId, now: Date): Promise<number> {
    return this.sessions.filter(
      (session) => session.userId.value === userId.value && session.isActive(now),
    ).length;
  }

  async findActiveByUserId(userId: UserId, now: Date): Promise<DeviceSession[]> {
    return this.sessions.filter(
      (session) => session.userId.value === userId.value && session.isActive(now),
    );
  }

  async save(session: DeviceSession): Promise<void> {
    const index = this.sessions.findIndex(
      (entry) => entry.sessionId.value === session.sessionId.value,
    );
    if (index >= 0) {
      this.sessions[index] = session;
      return;
    }
    this.sessions.push(session);
  }

  async rotateRefreshTokenIfHashMatches(input: {
    presentedHash: string;
    newHash: string;
    now: Date;
    expiresAt: Date;
    permissionsVersion: number;
  }): Promise<RotateRefreshTokenOutcome> {
    const index = this.sessions.findIndex(
      (session) =>
        session.refreshTokenHash.value === input.presentedHash && session.isActive(input.now),
    );

    if (index < 0) {
      return { status: 'hash_mismatch' };
    }

    const current = this.sessions[index];
    const rotated = DeviceSession.reconstitute({
      ...current.toProps(),
      previousRefreshTokenHash: input.presentedHash,
      refreshTokenHash: input.newHash,
      lastUsedAt: input.now,
      expiresAt: input.expiresAt,
      permissionsVersion: input.permissionsVersion,
    });
    this.sessions[index] = rotated;
    return { status: 'rotated', sessionId: rotated.sessionId.value };
  }

  async revokeAllByUserId(userId: UserId, at: Date, reason: string): Promise<void> {
    for (let index = 0; index < this.sessions.length; index += 1) {
      const session = this.sessions[index];
      if (session.userId.value === userId.value && session.isActive(at)) {
        this.sessions[index] = session.revoke(reason as never, at);
      }
    }
  }

  async revokeAllByUserIdExceptSession(input: {
    userId: UserId;
    exceptSessionId: SessionId;
    at: Date;
    reason: SessionRevokeReason;
  }): Promise<string[]> {
    const revokedSessionIds: string[] = [];
    for (let index = 0; index < this.sessions.length; index += 1) {
      const session = this.sessions[index];
      if (
        session.userId.value === input.userId.value &&
        session.sessionId.value !== input.exceptSessionId.value &&
        session.isActive(input.at)
      ) {
        this.sessions[index] = session.revoke(input.reason, input.at);
        revokedSessionIds.push(session.sessionId.value);
      }
    }
    return revokedSessionIds;
  }

  async updateSessionVersionIfActive(input: {
    sessionId: SessionId;
    userId: UserId;
    sessionVersion: number;
    at: Date;
  }): Promise<boolean> {
    const index = this.sessions.findIndex(
      (session) =>
        session.sessionId.value === input.sessionId.value &&
        session.userId.value === input.userId.value &&
        !session.isRevoked(),
    );
    if (index < 0) {
      return false;
    }
    this.sessions[index] = this.sessions[index].withSessionVersion(input.sessionVersion, input.at);
    return true;
  }

  async revokeAllByTokenFamilyId(
    tokenFamilyId: TokenFamilyId,
    at: Date,
    reason: SessionRevokeReason,
  ): Promise<void> {
    for (let index = 0; index < this.sessions.length; index += 1) {
      const session = this.sessions[index];
      if (session.tokenFamilyId.value === tokenFamilyId.value && session.isActive(at)) {
        this.sessions[index] = session.revoke(reason, at);
      }
    }
  }

  async revokeByIdIfOwnedByUser(input: {
    sessionId: SessionId;
    userId: UserId;
    at: Date;
    reason: SessionRevokeReason;
  }): Promise<RevokeSessionOutcome> {
    const index = this.sessions.findIndex(
      (session) =>
        session.sessionId.value === input.sessionId.value &&
        session.userId.value === input.userId.value,
    );

    if (index < 0) {
      return { status: 'not_found_or_not_owned' };
    }

    const session = this.sessions[index];
    if (session.isRevoked()) {
      return { status: 'already_revoked' };
    }

    this.sessions[index] = session.revoke(input.reason, input.at);
    return { status: 'revoked' };
  }
}

export class InMemoryTokenFamilyRepository implements TokenFamilyRepository {
  readonly families: TokenFamily[] = [];

  async findById(id: TokenFamilyId): Promise<TokenFamily | null> {
    return this.families.find((family) => family.tokenFamilyId.value === id.value) ?? null;
  }

  async save(family: TokenFamily): Promise<void> {
    const index = this.families.findIndex(
      (entry) => entry.tokenFamilyId.value === family.tokenFamilyId.value,
    );
    if (index >= 0) {
      this.families[index] = family;
      return;
    }
    this.families.push(family);
  }

  async revokeAllByUserId(userId: UserId, at: Date): Promise<void> {
    for (let index = 0; index < this.families.length; index += 1) {
      const family = this.families[index];
      if (family.userId.value === userId.value && !family.isRevoked()) {
        this.families[index] = family.revoke(at);
      }
    }
  }

  async revokeAllByUserIdExceptFamily(input: {
    userId: UserId;
    exceptTokenFamilyId: TokenFamilyId;
    at: Date;
  }): Promise<void> {
    for (let index = 0; index < this.families.length; index += 1) {
      const family = this.families[index];
      if (
        family.userId.value === input.userId.value &&
        family.tokenFamilyId.value !== input.exceptTokenFamilyId.value &&
        !family.isRevoked()
      ) {
        this.families[index] = family.revoke(input.at);
      }
    }
  }

  async markCompromisedIfActive(id: TokenFamilyId, at: Date): Promise<boolean> {
    const index = this.families.findIndex((family) => family.tokenFamilyId.value === id.value);
    if (index < 0 || this.families[index].isCompromised()) {
      return false;
    }
    this.families[index] = this.families[index].markCompromised(at);
    return true;
  }
}

export class InMemoryLoginAttemptRepository implements LoginAttemptRepository {
  readonly attempts: LoginAttemptRecord[] = [];

  async save(record: LoginAttemptRecord): Promise<void> {
    this.attempts.push({ ...record });
  }
}

export class InMemoryLoginOrganizationReader implements LoginOrganizationReaderPort {
  constructor(private snapshot: LoginOrganizationSnapshot | null = null) {}

  async findByUserId(_userId: UserId): Promise<LoginOrganizationSnapshot | null> {
    return this.snapshot;
  }

  setSnapshot(snapshot: LoginOrganizationSnapshot | null): void {
    this.snapshot = snapshot;
  }
}

export class InMemoryEmployeeAccessResolver implements EmployeeAccessResolverPort {
  constructor(private snapshot: EmployeeAccessSnapshot | null = null) {}

  async resolveForUserId(_userId: UserId): Promise<EmployeeAccessSnapshot | null> {
    return this.snapshot;
  }

  setSnapshot(snapshot: EmployeeAccessSnapshot | null): void {
    this.snapshot = snapshot;
  }
}

export class FakeTokenService implements TokenService {
  signAccessToken(claims: AccessTokenClaims): string {
    return `jwt.${claims.sub}.${claims.sessionId}`;
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    const [, sub, sessionId] = token.split('.');
    if (!sub || !sessionId) {
      throw new Error('Invalid test token.');
    }
    return {
      sub,
      actorType: AccessTokenActorType.User,
      sessionId,
      sessionVersion: 1,
      tokenFamilyId: 'family-id',
    };
  }
}

export class FixedAuthTokenTtl implements AuthTokenTtlPort {
  constructor(readonly accessTokenTtlSeconds: number) {}
}

export class FixedAuthRefreshPolicy implements AuthRefreshPolicyPort {
  constructor(readonly refreshConcurrentGraceMs: number) {}
}

// ---------------------------------------------------------------------------
// ADR-022 (Phase 2.23) — Customer phone-first registration & recovery
// ---------------------------------------------------------------------------

export class InMemoryPendingCustomerRegistrationRepository implements PendingCustomerRegistrationRepository {
  readonly rows: PendingCustomerRegistrationRecord[] = [];

  async findByPhone(phone: string): Promise<PendingCustomerRegistrationRecord | null> {
    return this.rows.find((row) => row.phone === phone) ?? null;
  }

  async findById(id: string): Promise<PendingCustomerRegistrationRecord | null> {
    return this.rows.find((row) => row.id === id) ?? null;
  }

  async upsertActive(input: {
    username: string;
    phone: string;
    codeHash: string;
    codeExpiresAt: Date;
    now: Date;
  }): Promise<PendingCustomerRegistrationRecord> {
    const usernameTaken = this.rows.some(
      (row) => row.username === input.username && row.phone !== input.phone,
    );
    if (usernameTaken) {
      throw new UsernameAlreadyExistsException();
    }

    const index = this.rows.findIndex((row) => row.phone === input.phone);
    if (index >= 0) {
      const updated: PendingCustomerRegistrationRecord = {
        ...this.rows[index],
        username: input.username,
        codeHash: input.codeHash,
        codeExpiresAt: input.codeExpiresAt,
        incorrectAttemptCount: 0,
        verifiedAt: null,
        updatedAt: input.now,
      };
      this.rows[index] = updated;
      return { ...updated };
    }

    const created: PendingCustomerRegistrationRecord = {
      id: `pending-${this.rows.length + 1}`,
      username: input.username,
      phone: input.phone,
      codeHash: input.codeHash,
      codeExpiresAt: input.codeExpiresAt,
      incorrectAttemptCount: 0,
      verifiedAt: null,
      consumedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.rows.push(created);
    return { ...created };
  }

  async incrementAttemptCount(id: string): Promise<void> {
    const row = this.rows.find((entry) => entry.id === id);
    if (row) {
      row.incorrectAttemptCount += 1;
    }
  }

  async markVerified(id: string, at: Date): Promise<void> {
    const row = this.rows.find((entry) => entry.id === id);
    if (row) {
      row.verifiedAt = at;
      row.updatedAt = at;
    }
  }

  async consumeIfVerifiedAndUnconsumed(
    id: string,
    at: Date,
  ): Promise<PendingCustomerRegistrationRecord | null> {
    const row = this.rows.find((entry) => entry.id === id);
    if (!row || row.consumedAt !== null || row.verifiedAt === null) {
      return null;
    }
    row.consumedAt = at;
    row.updatedAt = at;
    return { ...row };
  }

  async deleteById(id: string): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index >= 0) {
      this.rows.splice(index, 1);
    }
  }

  async existsByUsername(username: string): Promise<boolean> {
    return this.rows.some((row) => row.username === username);
  }

  async existsByPhone(phone: string): Promise<boolean> {
    return this.rows.some((row) => row.phone === phone);
  }
}

export class InMemoryCustomerPasswordResetRepository implements CustomerPasswordResetRepository {
  readonly rows: CustomerPasswordResetTokenRecord[] = [];

  async findActiveByUserId(
    userId: UserId,
    now: Date,
  ): Promise<CustomerPasswordResetTokenRecord | null> {
    return (
      this.rows.find(
        (row) => row.userId === userId.value && row.consumedAt === null && row.codeExpiresAt > now,
      ) ?? null
    );
  }

  async save(record: CustomerPasswordResetTokenRecord): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === record.id);
    if (index >= 0) {
      this.rows[index] = { ...record };
      return;
    }
    this.rows.push({ ...record });
  }

  async invalidateActiveByUserId(userId: UserId): Promise<void> {
    const now = new Date();
    for (const row of this.rows) {
      if (row.userId === userId.value && row.consumedAt === null) {
        row.consumedAt = now;
      }
    }
  }

  async incrementAttemptCount(id: string): Promise<void> {
    const row = this.rows.find((entry) => entry.id === id);
    if (row) {
      row.incorrectAttemptCount += 1;
    }
  }

  async markVerified(id: string, at: Date): Promise<void> {
    const row = this.rows.find((entry) => entry.id === id);
    if (row) {
      row.verifiedAt = at;
      row.updatedAt = at;
    }
  }

  async consumeIfVerifiedAndUnconsumed(
    id: string,
    at: Date,
  ): Promise<CustomerPasswordResetTokenRecord | null> {
    const row = this.rows.find((entry) => entry.id === id);
    if (!row || row.consumedAt !== null || row.verifiedAt === null) {
      return null;
    }
    row.consumedAt = at;
    row.updatedAt = at;
    return { ...row };
  }
}

export class FakeOtpService implements OtpService {
  private counter = 0;

  generate(): string {
    this.counter += 1;
    return this.counter.toString().padStart(6, '0');
  }

  hash(code: string): string {
    return `otp-hash-${code}`;
  }

  verify(code: string, storedHash: string): boolean {
    return this.hash(code) === storedHash;
  }
}

/**
 * Test double for `VerificationMessagingPort` (ADR-022/TESTING_STRATEGY.md:
 * "real third-party providers... never called from any automated test").
 * Records every call for assertion (target/message content, call count)
 * without any network access; `nextResult` lets a test simulate a Fonnte
 * failure without touching the real provider.
 */
export class RecordingVerificationMessagingPort implements VerificationMessagingPort {
  readonly calls: Array<{ phone: string; code: string }> = [];
  nextResult: VerificationMessagingResult = { status: 'sent' };

  async sendVerificationCode(
    phone: PhoneNumber,
    code: string,
  ): Promise<VerificationMessagingResult> {
    this.calls.push({ phone: phone.value, code });
    return this.nextResult;
  }
}
