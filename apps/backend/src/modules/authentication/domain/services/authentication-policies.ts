import { User } from '../entities/user.entity';
import { DeviceSession } from '../entities/device-session.entity';
import { TokenFamily } from '../entities/token-family.entity';
import { RefreshTokenHash } from '@shared/domain/value-objects/refresh-token-hash.vo';
import { Password } from '@shared/domain/value-objects/password.vo';
import { PasswordHash } from '@shared/domain/value-objects/password-hash.vo';
import { PasswordHasher } from './password-hasher.port';
import { RefreshTokenReuseException } from '../exceptions/refresh-token-reuse.exception';
import { MaxActiveSessionsExceededException } from '../exceptions/max-active-sessions.exception';
import { PasswordReusedException } from '../exceptions/password-reused.exception';
import { SessionRevokeReason } from '../enums/authentication.enums';
import { PasswordHistoryRecord } from '../repositories/authentication.repositories';

export interface SessionPolicyConfig {
  maxActiveSessionsPerUser: number;
  refreshTokenTtlDays: number;
}

export class SessionPolicy {
  static assertCanCreateSession(activeSessionCount: number, config: SessionPolicyConfig): void {
    if (activeSessionCount >= config.maxActiveSessionsPerUser) {
      throw new MaxActiveSessionsExceededException(config.maxActiveSessionsPerUser);
    }
  }

  static calculateRefreshExpiry(now: Date, ttlDays: number): Date {
    return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
  }

  static isSessionVersionStale(sessionSnapshot: number, userSessionVersion: number): boolean {
    return sessionSnapshot !== userSessionVersion;
  }
}

export interface LoginPolicyConfig {
  maxFailedLoginAttempts: number;
  accountLockDurationMinutes: number;
}

export class LoginPolicy {
  static applyFailedLogin(user: User, config: LoginPolicyConfig, at: Date): User {
    return user.recordFailedLogin(
      config.maxFailedLoginAttempts,
      config.accountLockDurationMinutes,
      at,
    );
  }
}

export class TokenFamilyPolicy {
  static handleRefreshTokenReuse(
    family: TokenFamily,
    at: Date,
  ): { family: TokenFamily; compromised: true } {
    if (!family.isCompromised()) {
      return { family: family.markCompromised(at), compromised: true };
    }
    throw new RefreshTokenReuseException();
  }

  static assertRefreshHashMatches(session: DeviceSession, presentedHash: RefreshTokenHash): void {
    if (!session.refreshTokenHash.equals(presentedHash)) {
      throw new RefreshTokenReuseException();
    }
  }
}

export interface PasswordHistoryPolicyConfig {
  passwordHistoryCount: number;
}

export class AuthenticationPolicy {
  static async assertPasswordNotReused(
    password: Password,
    currentHash: PasswordHash,
    history: PasswordHistoryRecord[],
    hasher: PasswordHasher,
  ): Promise<void> {
    if (await hasher.verify(password, currentHash)) {
      throw new PasswordReusedException();
    }

    for (const entry of history) {
      if (await hasher.verify(password, PasswordHash.create(entry.passwordHash))) {
        throw new PasswordReusedException();
      }
    }
  }

  static shouldRevokeSessionsOnPasswordChange(): SessionRevokeReason {
    return SessionRevokeReason.PasswordChange;
  }
}
