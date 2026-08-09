import { TokenExpiredError } from 'jsonwebtoken';
import { User } from '@modules/authentication/domain/entities/user.entity';
import { UserStatus } from '@modules/authentication/domain/enums/authentication.enums';
import {
  AccessTokenActorType,
  AccessTokenClaims,
} from '@modules/authentication/domain/services/access-token-claims';
import { TokenService } from '@modules/authentication/domain/services/token-service.port';
import {
  ExpiredAccessTokenException,
  InvalidAccessTokenException,
  StaleSessionVersionException,
} from '@modules/authentication/application/exceptions/access-token.exceptions';
import {
  AccountLockedException,
  AccountSuspendedException,
} from '@modules/authentication/application/exceptions/login.exceptions';
import { InMemoryUserRepository } from '../../../../test/authentication/support/in-memory-registration.dependencies';
import { WsAuthenticationService } from './ws-authentication.service';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const tokenFamilyId = '33333333-3333-4333-8333-333333333333';
const employeeId = '44444444-4444-4444-8444-444444444444';
const restaurantId = '55555555-5555-4555-8555-555555555555';
const organizationId = '66666666-6666-4666-8666-666666666666';

class StubTokenService implements TokenService {
  constructor(private readonly claimsOrError: AccessTokenClaims | Error) {}

  signAccessToken(): string {
    return 'unused';
  }

  verifyAccessToken(): AccessTokenClaims {
    if (this.claimsOrError instanceof Error) {
      throw this.claimsOrError;
    }
    return this.claimsOrError;
  }
}

function userProps(
  overrides: Partial<{ sessionVersion: number; status: UserStatus; lockedUntil: Date | null }> = {},
) {
  return {
    id: userId,
    firstName: null,
    lastName: null,
    email: null,
    phone: '+963000000000',
    username: 'guest1',
    passwordHash: 'argon2id$fake$x',
    language: 'en',
    preferredCurrency: null,
    notificationOptIn: false,
    marketingOptIn: false,
    status: overrides.status ?? UserStatus.Active,
    emailVerified: true,
    failedLoginCount: 0,
    lockedUntil: overrides.lockedUntil ?? null,
    permissionsVersion: 1,
    sessionVersion: overrides.sessionVersion ?? 1,
    passwordChangedAt: null,
    lastLoginAt: null,
    anonymizedAt: null,
    deletionRequestedAt: null,
    scheduledAnonymizationAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };
}

function activeUser(overrides: Partial<{ sessionVersion: number; status: UserStatus }> = {}): User {
  return User.create(userProps(overrides));
}

function userClaims(overrides: Partial<AccessTokenClaims> = {}): AccessTokenClaims {
  return {
    sub: userId,
    actorType: AccessTokenActorType.User,
    sessionId,
    sessionVersion: 1,
    tokenFamilyId,
    exp: Math.floor(Date.now() / 1000) + 900,
    ...overrides,
  } as AccessTokenClaims;
}

describe('WsAuthenticationService', () => {
  it('authenticates a valid User token and returns its exp as expiresAt', async () => {
    const userRepository = new InMemoryUserRepository();
    await userRepository.save(activeUser());
    const expSeconds = Math.floor(Date.now() / 1000) + 900;
    const service = new WsAuthenticationService(
      new StubTokenService(userClaims({ exp: expSeconds })),
      userRepository,
    );

    const result = await service.authenticate('a-valid-token');

    expect(result.actor).toMatchObject({ actorType: AccessTokenActorType.User, userId });
    expect(result.expiresAt).toEqual(new Date(expSeconds * 1000));
  });

  it('builds an Employee actor from Employee claims', async () => {
    const userRepository = new InMemoryUserRepository();
    await userRepository.save(activeUser());
    const service = new WsAuthenticationService(
      new StubTokenService(
        userClaims({
          actorType: AccessTokenActorType.Employee,
          employeeId,
          organizationId,
          restaurantId,
          branchIds: ['branch-1'],
          permissions: ['reservations:cancel'],
          permissionsVersion: 1,
        }),
      ),
      userRepository,
    );

    const result = await service.authenticate('a-valid-token');

    expect(result.actor).toMatchObject({
      actorType: AccessTokenActorType.Employee,
      employeeId,
      restaurantId,
      branchIds: ['branch-1'],
    });
  });

  it('builds an OrganizationMember actor from OrganizationMember claims', async () => {
    const userRepository = new InMemoryUserRepository();
    await userRepository.save(activeUser());
    const service = new WsAuthenticationService(
      new StubTokenService(
        userClaims({
          actorType: AccessTokenActorType.OrganizationMember,
          organizationId,
          orgRole: 'Owner',
          permissionsVersion: 1,
        }),
      ),
      userRepository,
    );

    const result = await service.authenticate('a-valid-token');

    expect(result.actor).toMatchObject({
      actorType: AccessTokenActorType.OrganizationMember,
      organizationId,
      orgRole: 'Owner',
    });
  });

  it('rejects a missing token', async () => {
    const userRepository = new InMemoryUserRepository();
    const service = new WsAuthenticationService(new StubTokenService(userClaims()), userRepository);

    await expect(service.authenticate(undefined)).rejects.toBeInstanceOf(
      InvalidAccessTokenException,
    );
    await expect(service.authenticate('')).rejects.toBeInstanceOf(InvalidAccessTokenException);
    await expect(service.authenticate('   ')).rejects.toBeInstanceOf(InvalidAccessTokenException);
  });

  it('rejects an invalid/malformed token', async () => {
    const userRepository = new InMemoryUserRepository();
    const service = new WsAuthenticationService(
      new StubTokenService(new Error('bad signature')),
      userRepository,
    );

    await expect(service.authenticate('garbage')).rejects.toBeInstanceOf(
      InvalidAccessTokenException,
    );
  });

  it('rejects an expired token with ExpiredAccessTokenException specifically', async () => {
    const userRepository = new InMemoryUserRepository();
    const service = new WsAuthenticationService(
      new StubTokenService(new TokenExpiredError('jwt expired', new Date())),
      userRepository,
    );

    await expect(service.authenticate('expired')).rejects.toBeInstanceOf(
      ExpiredAccessTokenException,
    );
  });

  it('rejects a token naming a PlatformAdmin actor', async () => {
    const userRepository = new InMemoryUserRepository();
    const service = new WsAuthenticationService(
      new StubTokenService(userClaims({ actorType: AccessTokenActorType.PlatformAdmin })),
      userRepository,
    );

    await expect(service.authenticate('a-token')).rejects.toBeInstanceOf(
      InvalidAccessTokenException,
    );
  });

  it('rejects when the user no longer exists', async () => {
    const userRepository = new InMemoryUserRepository();
    const service = new WsAuthenticationService(new StubTokenService(userClaims()), userRepository);

    await expect(service.authenticate('a-token')).rejects.toBeInstanceOf(
      InvalidAccessTokenException,
    );
  });

  it('rejects a suspended account', async () => {
    const userRepository = new InMemoryUserRepository();
    await userRepository.save(activeUser({ status: UserStatus.Suspended }));
    const service = new WsAuthenticationService(new StubTokenService(userClaims()), userRepository);

    await expect(service.authenticate('a-token')).rejects.toBeInstanceOf(AccountSuspendedException);
  });

  it('rejects a locked account', async () => {
    const userRepository = new InMemoryUserRepository();
    const locked = User.reconstitute(
      userProps({ status: UserStatus.Locked, lockedUntil: new Date(Date.now() + 60_000) }),
    );
    await userRepository.save(locked);
    const service = new WsAuthenticationService(new StubTokenService(userClaims()), userRepository);

    await expect(service.authenticate('a-token')).rejects.toBeInstanceOf(AccountLockedException);
  });

  it('rejects a stale sessionVersion (session-version mismatch)', async () => {
    const userRepository = new InMemoryUserRepository();
    await userRepository.save(activeUser({ sessionVersion: 2 }));
    const service = new WsAuthenticationService(
      new StubTokenService(userClaims({ sessionVersion: 1 })),
      userRepository,
    );

    await expect(service.authenticate('a-token')).rejects.toBeInstanceOf(
      StaleSessionVersionException,
    );
  });

  it('returns expiresAt: null when the claims carry no exp', async () => {
    const userRepository = new InMemoryUserRepository();
    await userRepository.save(activeUser());
    const service = new WsAuthenticationService(
      new StubTokenService(userClaims({ exp: undefined })),
      userRepository,
    );

    const result = await service.authenticate('a-token');

    expect(result.expiresAt).toBeNull();
  });
});
