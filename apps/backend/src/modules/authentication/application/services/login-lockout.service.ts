import { Inject, Injectable } from '@nestjs/common';
import { User } from '../../domain/entities/user.entity';
import {
  LoginFailureCounterPort,
  LOGIN_FAILURE_COUNTER,
} from '../../domain/services/login-failure-counter.port';
import { LoginPolicy } from '../../domain/services/authentication-policies';
import { SYSTEM_CONFIGURATION } from '../../domain/tokens/authentication.tokens';
import {
  SYSTEM_CONFIG_KEYS,
  SystemConfigurationPort,
} from '@shared/application/ports/system-configuration.port';

/**
 * How many times the per-address limit an account may fail, from all
 * addresses together, before the account itself is locked. Stops a
 * distributed guessing run without letting one address lock anyone out.
 */
export const ACCOUNT_WIDE_LOCK_MULTIPLIER = 10;

export interface LoginLockout {
  lockedUntil: Date;
}

/**
 * ADR-048: failed sign-ins lock the account only for the address they came
 * from (`maxFailedLoginAttempts` per account and address). Someone who knows
 * an email can no longer keep its owner out from their own device. The
 * account-wide lock on the User row still exists, at
 * `maxFailedLoginAttempts * ACCOUNT_WIDE_LOCK_MULTIPLIER` failures.
 */
@Injectable()
export class LoginLockoutService {
  constructor(
    @Inject(LOGIN_FAILURE_COUNTER) private readonly failureCounter: LoginFailureCounterPort,
    @Inject(SYSTEM_CONFIGURATION) private readonly systemConfiguration: SystemConfigurationPort,
  ) {}

  /** The lock that applies to this account from this address, or null. */
  async lockFor(user: User, ipAddress: string, now: Date): Promise<LoginLockout | null> {
    const { maxFailedLoginAttempts, accountLockDurationMinutes } = await this.policy();
    const failures = await this.failureCounter.count(this.key(user, ipAddress));
    if (failures < maxFailedLoginAttempts) {
      return null;
    }
    return { lockedUntil: new Date(now.getTime() + accountLockDurationMinutes * 60_000) };
  }

  /** Counts a failed sign-in and returns the User with its account-wide count updated. */
  async recordFailure(user: User, ipAddress: string, now: Date): Promise<User> {
    const { maxFailedLoginAttempts, accountLockDurationMinutes } = await this.policy();
    await this.failureCounter.increment(this.key(user, ipAddress), accountLockDurationMinutes * 60);
    return LoginPolicy.applyFailedLogin(
      user,
      {
        maxFailedLoginAttempts: maxFailedLoginAttempts * ACCOUNT_WIDE_LOCK_MULTIPLIER,
        accountLockDurationMinutes,
      },
      now,
    );
  }

  async clear(user: User, ipAddress: string): Promise<void> {
    await this.failureCounter.clear(this.key(user, ipAddress));
  }

  private key(user: User, ipAddress: string): string {
    return `auth:login-failures:${user.userId.value}:${ipAddress}`;
  }

  private async policy(): Promise<{
    maxFailedLoginAttempts: number;
    accountLockDurationMinutes: number;
  }> {
    const [maxFailedLoginAttempts, accountLockDurationMinutes] = await Promise.all([
      this.systemConfiguration.getNumber(SYSTEM_CONFIG_KEYS.maxFailedLoginAttempts, 5),
      this.systemConfiguration.getNumber(SYSTEM_CONFIG_KEYS.accountLockDurationMinutes, 30),
    ]);
    return { maxFailedLoginAttempts, accountLockDurationMinutes };
  }
}
