import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { SessionVersionGuard } from '../guards/session-version.guard';
import { RateLimitGuard } from '../guards/rate-limit.guard';
import { LoginUseCase } from '../../application/use-cases/login.use-case';
import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case';
import { LogoutCurrentSessionUseCase } from '../../application/use-cases/logout-current-session.use-case';
import { LogoutAllDevicesUseCase } from '../../application/use-cases/logout-all-devices.use-case';
import { ListActiveSessionsUseCase } from '../../application/use-cases/list-active-sessions.use-case';
import { RevokeSessionUseCase } from '../../application/use-cases/revoke-session.use-case';
import { ForgotPasswordUseCase } from '../../application/use-cases/forgot-password.use-case';
import { ResetPasswordUseCase } from '../../application/use-cases/reset-password.use-case';
import { ChangePasswordUseCase } from '../../application/use-cases/change-password.use-case';
import { InvalidCredentialsException } from '../../application/exceptions/login.exceptions';
import { InvalidRefreshTokenException } from '../../application/exceptions/invalid-refresh-token.exception';
import { SessionAccessDeniedException } from '../../application/exceptions/session-access-denied.exception';
import { UserStatus, DeviceType } from '../../domain/enums/authentication.enums';
import { AccessTokenActorType } from '../../domain/services/access-token-claims';
import { AuthenticatedUserActor } from '../../application/dto/authenticated-actor.dto';
import { ONESIGNAL_IDENTITY_TOKEN_SIGNER } from '@shared/application/ports/onesignal-identity-token-signer.port';

describe('AuthController', () => {
  let controller: AuthController;
  const loginExecute = jest.fn();
  const refreshExecute = jest.fn();
  const logoutCurrentExecute = jest.fn();
  const logoutAllExecute = jest.fn();
  const listSessionsExecute = jest.fn();
  const onesignalSign = jest.fn().mockReturnValue(null);
  const revokeSessionExecute = jest.fn();
  const forgotPasswordExecute = jest.fn();
  const resetPasswordExecute = jest.fn();
  const changePasswordExecute = jest.fn();

  const actor: AuthenticatedUserActor = {
    actorType: AccessTokenActorType.User,
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: '33333333-3333-4333-8333-333333333333',
    sessionVersion: 1,
    tokenFamilyId: '22222222-2222-4222-8222-222222222222',
  };

  beforeEach(async () => {
    loginExecute.mockReset();
    refreshExecute.mockReset();
    logoutCurrentExecute.mockReset();
    logoutAllExecute.mockReset();
    listSessionsExecute.mockReset();
    revokeSessionExecute.mockReset();
    forgotPasswordExecute.mockReset();
    resetPasswordExecute.mockReset();
    changePasswordExecute.mockReset();
    onesignalSign.mockReset().mockReturnValue(null);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: LoginUseCase,
          useValue: { execute: loginExecute },
        },
        {
          provide: RefreshSessionUseCase,
          useValue: { execute: refreshExecute },
        },
        {
          provide: LogoutCurrentSessionUseCase,
          useValue: { execute: logoutCurrentExecute },
        },
        {
          provide: LogoutAllDevicesUseCase,
          useValue: { execute: logoutAllExecute },
        },
        {
          provide: ListActiveSessionsUseCase,
          useValue: { execute: listSessionsExecute },
        },
        {
          provide: RevokeSessionUseCase,
          useValue: { execute: revokeSessionExecute },
        },
        {
          provide: ForgotPasswordUseCase,
          useValue: { execute: forgotPasswordExecute },
        },
        {
          provide: ResetPasswordUseCase,
          useValue: { execute: resetPasswordExecute },
        },
        {
          provide: ChangePasswordUseCase,
          useValue: { execute: changePasswordExecute },
        },
        {
          provide: ONESIGNAL_IDENTITY_TOKEN_SIGNER,
          useValue: { sign: onesignalSign, getExpirySeconds: () => 3600 },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(SessionVersionGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(RateLimitGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get(AuthController);
  });

  it('delegates login to the use case and maps response timestamps', async () => {
    const accessExpires = new Date('2026-07-07T18:15:00.000Z');
    const refreshExpires = new Date('2026-08-06T18:00:00.000Z');
    loginExecute.mockResolvedValue({
      accessToken: 'jwt-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: accessExpires,
      refreshTokenExpiresAt: refreshExpires,
      user: {
        userId: '11111111-1111-4111-8111-111111111111',
        email: 'owner@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        status: UserStatus.Active,
        emailVerified: true,
      },
      organization: null,
      sessionId: '33333333-3333-4333-8333-333333333333',
      sessionVersion: 1,
      permissionsVersion: 1,
      actorType: AccessTokenActorType.User,
      requiresPasswordChange: false,
    });

    const request = {
      ip: '203.0.113.44',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'user-agent': 'jest-agent' },
    } as unknown as Request;

    const response = await controller.login(
      { email: 'owner@example.com', password: 'SecurePass123!' },
      request,
    );

    expect(loginExecute).toHaveBeenCalledWith({
      email: 'owner@example.com',
      password: 'SecurePass123!',
      deviceName: undefined,
      deviceType: undefined,
      ipAddress: '203.0.113.44',
      userAgent: 'jest-agent',
    });
    expect(response.accessTokenExpiresAt).toBe(accessExpires.toISOString());
    expect(response.refreshTokenExpiresAt).toBe(refreshExpires.toISOString());
  });

  it('propagates login application exceptions', async () => {
    loginExecute.mockRejectedValue(new InvalidCredentialsException());

    const request = {
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
    } as unknown as Request;

    await expect(
      controller.login({ email: 'owner@example.com', password: 'SecurePass123!' }, request),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
  });

  it('does not catch framework HTTP exceptions', async () => {
    loginExecute.mockRejectedValue(new UnauthorizedException());

    const request = {
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
    } as unknown as Request;

    await expect(
      controller.login({ email: 'owner@example.com', password: 'SecurePass123!' }, request),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('delegates refresh to the use case and maps response timestamps', async () => {
    const accessExpires = new Date('2026-07-07T18:15:00.000Z');
    const refreshExpires = new Date('2026-08-06T18:00:00.000Z');
    const issuedAt = new Date('2026-07-07T18:00:00.000Z');
    refreshExecute.mockResolvedValue({
      userId: '11111111-1111-4111-8111-111111111111',
      accessToken: 'jwt-token',
      refreshToken: 'new-refresh-token',
      tokenType: 'Bearer',
      accessTokenExpiresAt: accessExpires,
      refreshTokenExpiresAt: refreshExpires,
      sessionId: '33333333-3333-4333-8333-333333333333',
      sessionVersion: 1,
      permissionsVersion: 1,
      actorType: AccessTokenActorType.User,
      issuedAt,
      serverTime: issuedAt,
    });

    const request = {
      ip: '203.0.113.44',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'user-agent': 'jest-agent' },
    } as unknown as Request;

    const response = await controller.refresh({ refreshToken: 'old-refresh-token' }, request);

    expect(refreshExecute).toHaveBeenCalledWith({
      refreshToken: 'old-refresh-token',
      ipAddress: '203.0.113.44',
      userAgent: 'jest-agent',
    });
    expect(onesignalSign).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(response.accessTokenExpiresAt).toBe(accessExpires.toISOString());
    expect(response.refreshTokenExpiresAt).toBe(refreshExpires.toISOString());
    expect(response.issuedAt).toBe(issuedAt.toISOString());
    expect(response.serverTime).toBe(issuedAt.toISOString());
    expect(response.onesignalIdentityToken).toBeNull();
  });

  it('propagates refresh application exceptions', async () => {
    refreshExecute.mockRejectedValue(new InvalidRefreshTokenException());

    const request = {
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
    } as unknown as Request;

    await expect(controller.refresh({ refreshToken: 'bad-token' }, request)).rejects.toBeInstanceOf(
      InvalidRefreshTokenException,
    );
  });

  it('delegates logout to the use case', async () => {
    logoutCurrentExecute.mockResolvedValue({ sessionId: actor.sessionId });
    await expect(controller.logout(actor)).resolves.toBeUndefined();
    expect(logoutCurrentExecute).toHaveBeenCalledWith({ actor });
  });

  it('delegates logout-all to the use case', async () => {
    logoutAllExecute.mockResolvedValue({ sessionVersion: 2 });
    await expect(controller.logoutAll(actor)).resolves.toBeUndefined();
    expect(logoutAllExecute).toHaveBeenCalledWith({ actor });
  });

  it('delegates list sessions and maps timestamps', async () => {
    const createdAt = new Date('2026-07-07T17:00:00.000Z');
    const lastUsedAt = new Date('2026-07-07T18:00:00.000Z');
    const expiresAt = new Date('2026-08-06T18:00:00.000Z');
    listSessionsExecute.mockResolvedValue({
      sessions: [
        {
          sessionId: actor.sessionId,
          deviceName: 'Chrome',
          deviceType: DeviceType.Web,
          createdAt,
          lastUsedAt,
          expiresAt,
          isCurrentSession: true,
          ipAddress: '127.0.0.1',
        },
      ],
    });

    const response = await controller.listSessions(actor);
    expect(listSessionsExecute).toHaveBeenCalledWith({ actor });
    expect(response.sessions[0]?.createdAt).toBe(createdAt.toISOString());
    expect(response.sessions[0]?.lastUsedAt).toBe(lastUsedAt.toISOString());
    expect(response.sessions[0]?.expiresAt).toBe(expiresAt.toISOString());
  });

  it('delegates revoke session to the use case', async () => {
    revokeSessionExecute.mockResolvedValue({ sessionId: '44444444-4444-4444-8444-444444444444' });
    await expect(
      controller.revokeSession('44444444-4444-4444-8444-444444444444', actor),
    ).resolves.toBeUndefined();
    expect(revokeSessionExecute).toHaveBeenCalledWith({
      actor,
      targetSessionId: '44444444-4444-4444-8444-444444444444',
    });
  });

  it('propagates revoke session application exceptions', async () => {
    revokeSessionExecute.mockRejectedValue(new SessionAccessDeniedException());
    await expect(
      controller.revokeSession('44444444-4444-4444-8444-444444444444', actor),
    ).rejects.toBeInstanceOf(SessionAccessDeniedException);
  });

  it('delegates forgot-password to the use case', async () => {
    const result = {
      message: 'If an eligible account exists, password reset instructions will be sent.',
    };
    forgotPasswordExecute.mockResolvedValue(result);

    await expect(controller.forgotPassword({ email: 'owner@example.com' })).resolves.toEqual(
      result,
    );
    expect(forgotPasswordExecute).toHaveBeenCalledWith({ email: 'owner@example.com' });
  });

  it('delegates reset-password to the use case', async () => {
    const result = { message: 'Password reset successfully.' };
    resetPasswordExecute.mockResolvedValue(result);

    await expect(
      controller.resetPassword({ token: 'opaque-token', newPassword: 'BrandNewPass1!' }),
    ).resolves.toEqual(result);
    expect(resetPasswordExecute).toHaveBeenCalledWith({
      token: 'opaque-token',
      newPassword: 'BrandNewPass1!',
    });
  });

  it('delegates change-password to the use case', async () => {
    const accessTokenExpiresAt = new Date('2026-07-11T00:15:00.000Z');
    const result = {
      message: 'Password changed successfully.',
      sessionVersion: 2,
      accessToken: 'new-access-token',
      accessTokenExpiresAt,
    };
    changePasswordExecute.mockResolvedValue(result);

    await expect(
      controller.changePassword(
        { currentPassword: 'SecurePass123!', newPassword: 'BrandNewPass1!' },
        actor,
      ),
    ).resolves.toEqual({
      message: result.message,
      sessionVersion: result.sessionVersion,
      accessToken: result.accessToken,
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
    });
    expect(changePasswordExecute).toHaveBeenCalledWith({
      actor,
      currentPassword: 'SecurePass123!',
      newPassword: 'BrandNewPass1!',
    });
  });
});
