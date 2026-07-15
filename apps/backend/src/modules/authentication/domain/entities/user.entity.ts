import { Entity } from '@shared/domain/base/entity.base';
import { Email } from '@shared/domain/value-objects/email.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { AccountLockedException } from '../exceptions/account-locked.exception';
import { AccountSuspendedException } from '../exceptions/account-suspended.exception';
import { EmailNotVerifiedException } from '../exceptions/email-not-verified.exception';
import { UserStatus } from '../enums/authentication.enums';

export interface UserProps {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  passwordHash: string;
  language: string;
  preferredCurrency: string | null;
  notificationOptIn: boolean;
  marketingOptIn: boolean;
  status: UserStatus;
  emailVerified: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  permissionsVersion: number;
  sessionVersion: number;
  passwordChangedAt: Date | null;
  lastLoginAt: Date | null;
  anonymizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export class User extends Entity<UserProps> {
  private constructor(props: UserProps) {
    super(props);
  }

  static create(props: UserProps): User {
    Email.create(props.email);
    PasswordHash.create(props.passwordHash);
    if (props.sessionVersion < 1 || props.permissionsVersion < 1) {
      throw new Error('Version counters must be >= 1.');
    }
    return new User({ ...props });
  }

  static reconstitute(props: UserProps): User {
    return new User({ ...props });
  }

  get userId(): UserId {
    return UserId.create(this.props.id);
  }

  get email(): Email {
    return Email.create(this.props.email);
  }

  get firstName(): string {
    return this.props.firstName;
  }

  get lastName(): string {
    return this.props.lastName;
  }

  get phone(): string | null {
    return this.props.phone;
  }

  get language(): string {
    return this.props.language;
  }

  get preferredCurrency(): string | null {
    return this.props.preferredCurrency;
  }

  get notificationOptIn(): boolean {
    return this.props.notificationOptIn;
  }

  get marketingOptIn(): boolean {
    return this.props.marketingOptIn;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  get passwordHash(): PasswordHash {
    return PasswordHash.create(this.props.passwordHash);
  }

  get status(): UserStatus {
    return this.props.status;
  }

  get emailVerified(): boolean {
    return this.props.emailVerified;
  }

  get sessionVersion(): number {
    return this.props.sessionVersion;
  }

  get permissionsVersion(): number {
    return this.props.permissionsVersion;
  }

  get failedLoginCount(): number {
    return this.props.failedLoginCount;
  }

  get lockedUntil(): Date | null {
    return this.props.lockedUntil ? new Date(this.props.lockedUntil.getTime()) : null;
  }

  get deletedAt(): Date | null {
    return this.props.deletedAt ? new Date(this.props.deletedAt.getTime()) : null;
  }

  isSoftDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  isAnonymized(): boolean {
    return this.props.status === UserStatus.Anonymized;
  }

  canLogin(now: Date = new Date()): void {
    if (this.isSoftDeleted() || this.isAnonymized()) {
      throw new AccountSuspendedException();
    }
    if (this.props.status === UserStatus.Suspended) {
      throw new AccountSuspendedException();
    }
    if (this.props.status === UserStatus.Locked) {
      if (this.props.lockedUntil && this.props.lockedUntil > now) {
        throw new AccountLockedException(this.props.lockedUntil);
      }
    } else if (this.props.status !== UserStatus.Active) {
      throw new EmailNotVerifiedException();
    }
    if (!this.props.emailVerified) {
      throw new EmailNotVerifiedException();
    }
  }

  verifyEmail(at: Date = new Date()): User {
    if (this.props.emailVerified) {
      return this;
    }
    return User.reconstitute({
      ...this.props,
      emailVerified: true,
      status: UserStatus.Active,
      updatedAt: at,
    });
  }

  recordSuccessfulLogin(at: Date): User {
    return User.reconstitute({
      ...this.props,
      failedLoginCount: 0,
      lockedUntil: null,
      status: this.props.status === UserStatus.Locked ? UserStatus.Active : this.props.status,
      lastLoginAt: at,
      updatedAt: at,
    });
  }

  recordFailedLogin(maxAttempts: number, lockDurationMinutes: number, at: Date): User {
    const failedLoginCount = this.props.failedLoginCount + 1;
    const shouldLock = failedLoginCount >= maxAttempts;
    const lockedUntil = shouldLock
      ? new Date(at.getTime() + lockDurationMinutes * 60_000)
      : this.props.lockedUntil;

    return User.reconstitute({
      ...this.props,
      failedLoginCount,
      lockedUntil,
      status: shouldLock ? UserStatus.Locked : this.props.status,
      updatedAt: at,
    });
  }

  bumpSessionVersion(): User {
    return User.reconstitute({
      ...this.props,
      sessionVersion: this.props.sessionVersion + 1,
      updatedAt: new Date(),
    });
  }

  changePasswordHash(newHash: PasswordHash, at: Date): User {
    return User.reconstitute({
      ...this.props,
      passwordHash: newHash.value,
      passwordChangedAt: at,
      sessionVersion: this.props.sessionVersion + 1,
      updatedAt: at,
    });
  }

  completePasswordReset(newHash: PasswordHash, at: Date): User {
    return User.reconstitute({
      ...this.props,
      passwordHash: newHash.value,
      passwordChangedAt: at,
      sessionVersion: this.props.sessionVersion + 1,
      failedLoginCount: 0,
      lockedUntil: null,
      status: this.props.status === UserStatus.Locked ? UserStatus.Active : this.props.status,
      updatedAt: at,
    });
  }

  completePasswordChange(newHash: PasswordHash, at: Date): User {
    return User.reconstitute({
      ...this.props,
      passwordHash: newHash.value,
      passwordChangedAt: at,
      sessionVersion: this.props.sessionVersion + 1,
      failedLoginCount: 0,
      lockedUntil: null,
      status: this.props.status === UserStatus.Locked ? UserStatus.Active : this.props.status,
      updatedAt: at,
    });
  }

  /**
   * Self-service profile fields only (DOMAIN_MODEL.md User Aggregate "User
   * profile" responsibility) - never credentials, status, or version
   * counters, which have their own dedicated mutation methods above with
   * their own invariants.
   */
  updateProfile(
    props: {
      firstName: string;
      lastName: string;
      phone: string | null;
      language: string;
      preferredCurrency: string | null;
    },
    at: Date,
  ): User {
    return User.reconstitute({
      ...this.props,
      firstName: props.firstName,
      lastName: props.lastName,
      phone: props.phone,
      language: props.language,
      preferredCurrency: props.preferredCurrency,
      updatedAt: at,
    });
  }

  /**
   * Notification/marketing opt-in preferences only (DOMAIN_MODEL.md User
   * Aggregate "Preferences" responsibility) - kept as a separate mutation
   * from updateProfile() because it is a distinct self-service operation
   * with its own endpoint/audit action. language/preferredCurrency remain
   * part of the User Profile contract (see DECISIONS.md's reconciliation of
   * the pre-existing UserPreference documentation with the shipped Phase
   * 3.1 schema) and are deliberately not duplicated here.
   */
  updatePreferences(
    props: { notificationOptIn: boolean; marketingOptIn: boolean },
    at: Date,
  ): User {
    return User.reconstitute({
      ...this.props,
      notificationOptIn: props.notificationOptIn,
      marketingOptIn: props.marketingOptIn,
      updatedAt: at,
    });
  }

  toProps(): Readonly<UserProps> {
    return { ...this.props };
  }
}
