import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TokenExpiredError } from 'jsonwebtoken';
import { Password } from '@shared/domain/value-objects/password.vo';
import authConfig from '@config/auth.config';
import { Argon2PasswordHasher } from './argon2-password-hasher';
import { JwtTokenService } from './jwt-token.service';
import { Sha256OpaqueTokenService } from './sha256-opaque-token.service';
import {
  AccessTokenActorType,
  UserAccessTokenClaims,
} from '../../domain/services/access-token-claims';

const TEST_AUTH_ENV = {
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters-long',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters-long',
  ARGON2_MEMORY_COST: '4096',
  ARGON2_TIME_COST: '1',
  ARGON2_PARALLELISM: '1',
};

function setAuthEnv(): void {
  process.env.JWT_ACCESS_SECRET = TEST_AUTH_ENV.JWT_ACCESS_SECRET;
  process.env.JWT_REFRESH_SECRET = TEST_AUTH_ENV.JWT_REFRESH_SECRET;
  process.env.ARGON2_MEMORY_COST = TEST_AUTH_ENV.ARGON2_MEMORY_COST;
  process.env.ARGON2_TIME_COST = TEST_AUTH_ENV.ARGON2_TIME_COST;
  process.env.ARGON2_PARALLELISM = TEST_AUTH_ENV.ARGON2_PARALLELISM;
}

describe('authentication security infrastructure', () => {
  describe('Sha256OpaqueTokenService', () => {
    const service = new Sha256OpaqueTokenService();

    it('generates unique opaque tokens', () => {
      const a = service.generate();
      const b = service.generate();

      expect(a).not.toBe(b);
      expect(a.length).toBeGreaterThan(20);
    });

    it('hashes tokens deterministically with SHA-256 hex', () => {
      const token = 'sample-opaque-token';
      const hash = service.hash(token);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      expect(service.hash(token)).toBe(hash);
      expect(service.verify(token, hash)).toBe(true);
      expect(service.verify('wrong-token', hash)).toBe(false);
    });
  });

  describe('Argon2PasswordHasher', () => {
    let hasher: Argon2PasswordHasher;

    beforeAll(async () => {
      setAuthEnv();

      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            load: [authConfig],
          }),
        ],
        providers: [Argon2PasswordHasher],
      }).compile();

      hasher = moduleRef.get(Argon2PasswordHasher);
    });

    it('hashes and verifies passwords', async () => {
      const password = Password.create('SecurePass123!');
      const hash = await hasher.hash(password);

      expect(hash.value).toContain('$argon2');
      await expect(hasher.verify(password, hash)).resolves.toBe(true);
      await expect(hasher.verify(Password.create('WrongPass123!'), hash)).resolves.toBe(false);
    });
  });

  describe('JwtTokenService', () => {
    let tokenService: JwtTokenService;

    beforeAll(async () => {
      setAuthEnv();
      process.env.JWT_ACCESS_EXPIRY = '15m';

      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            load: [authConfig],
          }),
        ],
        providers: [JwtTokenService],
      }).compile();

      tokenService = moduleRef.get(JwtTokenService);
    });

    it('signs and verifies a customer access token', () => {
      const claims: UserAccessTokenClaims = {
        sub: '11111111-1111-4111-8111-111111111111',
        actorType: AccessTokenActorType.User,
        sessionId: '22222222-2222-4222-8222-222222222222',
        sessionVersion: 1,
        tokenFamilyId: '33333333-3333-4333-8333-333333333333',
      };

      const token = tokenService.signAccessToken(claims);
      const verified = tokenService.verifyAccessToken(token);

      expect(verified.sub).toBe(claims.sub);
      expect(verified.actorType).toBe(AccessTokenActorType.User);
      expect(verified.sessionVersion).toBe(1);
    });

    it('rejects tampered tokens', () => {
      const token = tokenService.signAccessToken({
        sub: '11111111-1111-4111-8111-111111111111',
        actorType: AccessTokenActorType.User,
        sessionId: '22222222-2222-4222-8222-222222222222',
        sessionVersion: 1,
        tokenFamilyId: '33333333-3333-4333-8333-333333333333',
      } satisfies UserAccessTokenClaims);

      expect(() => tokenService.verifyAccessToken(`${token}x`)).toThrow();
    });

    it('preserves the underlying TokenExpiredError as `cause` for an expired token', () => {
      const claims: UserAccessTokenClaims = {
        sub: '11111111-1111-4111-8111-111111111111',
        actorType: AccessTokenActorType.User,
        sessionId: '22222222-2222-4222-8222-222222222222',
        sessionVersion: 1,
        tokenFamilyId: '33333333-3333-4333-8333-333333333333',
      };
      const token = tokenService.signAccessToken(claims);

      jest.useFakeTimers({ now: new Date(Date.now() + 20 * 60 * 1000) });
      try {
        expect(() => tokenService.verifyAccessToken(token)).toThrow(UnauthorizedException);
        try {
          tokenService.verifyAccessToken(token);
          throw new Error('expected verifyAccessToken to throw');
        } catch (error) {
          expect(error).toBeInstanceOf(UnauthorizedException);
          expect((error as { cause?: unknown }).cause).toBeInstanceOf(TokenExpiredError);
        }
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
