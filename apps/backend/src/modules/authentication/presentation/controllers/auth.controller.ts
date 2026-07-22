import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { SkipResponseEnvelope } from '@common/decorators/skip-response-envelope.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { LoginUseCase } from '../../application/use-cases/login.use-case';
import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case';
import { LogoutCurrentSessionUseCase } from '../../application/use-cases/logout-current-session.use-case';
import { LogoutAllDevicesUseCase } from '../../application/use-cases/logout-all-devices.use-case';
import { ListActiveSessionsUseCase } from '../../application/use-cases/list-active-sessions.use-case';
import { RevokeSessionUseCase } from '../../application/use-cases/revoke-session.use-case';
import { ForgotPasswordUseCase } from '../../application/use-cases/forgot-password.use-case';
import { ResetPasswordUseCase } from '../../application/use-cases/reset-password.use-case';
import { ChangePasswordUseCase } from '../../application/use-cases/change-password.use-case';
import { AuthenticatedActor } from '../../application/dto/authenticated-actor.dto';
import { LoginRequestDto } from '../dto/login.request.dto';
import { LoginResponseDto } from '../dto/login.response.dto';
import { RefreshSessionRequestDto } from '../dto/refresh-session.request.dto';
import { RefreshSessionResponseDto } from '../dto/refresh-session.response.dto';
import { ListActiveSessionsResponseDto } from '../dto/list-active-sessions.response.dto';
import { ForgotPasswordRequestDto } from '../dto/forgot-password.request.dto';
import { ForgotPasswordResponseDto } from '../dto/forgot-password.response.dto';
import { ResetPasswordRequestDto } from '../dto/reset-password.request.dto';
import { ResetPasswordResponseDto } from '../dto/reset-password.response.dto';
import { ChangePasswordRequestDto } from '../dto/change-password.request.dto';
import { ChangePasswordResponseDto } from '../dto/change-password.response.dto';
import { LoginResult } from '../../application/dto/login.result';
import { RefreshSessionResult } from '../../application/dto/refresh-session.result';
import { ChangePasswordResult } from '../../application/dto/change-password.result';
import { ListActiveSessionsResult } from '../../application/dto/list-active-sessions.dto';
import { CurrentActor } from '../decorators/current-actor.decorator';
import { RateLimit } from '../decorators/rate-limit.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { SessionVersionGuard } from '../guards/session-version.guard';
import { RateLimitGuard } from '../guards/rate-limit.guard';
import { resolveClientIp } from '../utils/resolve-client-ip.util';

/**
 * ADR-022 (Phase 2.23 closure): public Owner self-registration
 * (`POST /auth/register`) and email verification (`POST /auth/verify-email`)
 * are RETIRED - no surviving actor requires them (Customers never had
 * email; Restaurant Owners are now provisioned only by Platform Admin via
 * `POST /platform-admin/restaurant-owners`, with no verification step).
 * See `DECISIONS.md` ADR-022 for the full retirement rationale.
 */
@ApiTags('Authentication')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly loginUseCase: LoginUseCase,
    private readonly refreshSessionUseCase: RefreshSessionUseCase,
    private readonly logoutCurrentSessionUseCase: LogoutCurrentSessionUseCase,
    private readonly logoutAllDevicesUseCase: LogoutAllDevicesUseCase,
    private readonly listActiveSessionsUseCase: ListActiveSessionsUseCase,
    private readonly revokeSessionUseCase: RevokeSessionUseCase,
    private readonly forgotPasswordUseCase: ForgotPasswordUseCase,
    private readonly resetPasswordUseCase: ResetPasswordUseCase,
    private readonly changePasswordUseCase: ChangePasswordUseCase,
  ) {}

  @Post('login')
  @UseGuards(RateLimitGuard)
  @RateLimit('login')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Login successful.')
  @ApiOperation({
    operationId: 'authLogin',
    summary: 'Authenticate with email and password',
    description:
      'Issues a new access/refresh token pair and creates a device session. Rate limited to 10 requests/15min/IP.',
  })
  @ApiResponse({ status: 200, description: 'Login successful', type: LoginResponseDto })
  @ApiErrorResponse(401, 'Invalid credentials', ['AUTH_INVALID_CREDENTIALS'])
  @ApiErrorResponse(403, 'Account locked, suspended, or email not verified', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_EMAIL_NOT_VERIFIED',
  ])
  @ApiErrorResponse(409, 'Too many active sessions for this account', ['AUTH_TOO_MANY_SESSIONS'])
  @ApiErrorResponse(429, 'Too many login attempts from this IP', ['RATE_LIMIT_EXCEEDED'])
  async login(@Body() body: LoginRequestDto, @Req() request: Request): Promise<LoginResponseDto> {
    const result = await this.loginUseCase.execute({
      email: body.email,
      password: body.password,
      deviceName: body.deviceName,
      deviceType: body.deviceType,
      ipAddress: resolveClientIp(request),
      userAgent: request.headers['user-agent'],
    });

    return this.toLoginResponse(result);
  }

  @Post('refresh')
  @UseGuards(RateLimitGuard)
  @RateLimit('refresh')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Session refreshed successfully.')
  @ApiOperation({
    operationId: 'authRefreshSession',
    summary: 'Rotate refresh token and issue a new access token',
    description:
      'Consumes the supplied refresh token, issues a new access/refresh token pair, and rotates the session. Reusing an already-rotated (or otherwise invalid) refresh token revokes the entire token family. Rate limited to 30 requests/min per token.',
  })
  @ApiResponse({ status: 200, description: 'Tokens rotated', type: RefreshSessionResponseDto })
  @ApiErrorResponse(
    401,
    'Refresh token is invalid, unknown, expired, revoked, or reused (token family compromised)',
    ['AUTH_INVALID_REFRESH_TOKEN'],
  )
  @ApiErrorResponse(403, 'Account locked, suspended, or email not verified', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_EMAIL_NOT_VERIFIED',
  ])
  @ApiErrorResponse(429, 'Too many refresh attempts for this token', ['RATE_LIMIT_EXCEEDED'])
  async refresh(
    @Body() body: RefreshSessionRequestDto,
    @Req() request: Request,
  ): Promise<RefreshSessionResponseDto> {
    const result = await this.refreshSessionUseCase.execute({
      refreshToken: body.refreshToken,
      ipAddress: resolveClientIp(request),
      userAgent: request.headers['user-agent'],
    });

    return this.toRefreshResponse(result);
  }

  @Post('forgot-password')
  @UseGuards(RateLimitGuard)
  @RateLimit('forgotPassword')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Password reset request accepted.')
  @ApiOperation({
    operationId: 'authForgotPassword',
    summary: 'Request a password reset email',
    description:
      'Always returns a generic 200 acceptance response regardless of whether the email is registered, to avoid leaking account existence. Rate limited to 3 requests/hour per email.',
  })
  @ApiResponse({
    status: 200,
    description: 'Generic acceptance response',
    type: ForgotPasswordResponseDto,
  })
  @ApiErrorResponse(429, 'Too many reset requests for this email', ['RATE_LIMIT_EXCEEDED'])
  async forgotPassword(@Body() body: ForgotPasswordRequestDto): Promise<ForgotPasswordResponseDto> {
    return this.forgotPasswordUseCase.execute({ email: body.email });
  }

  @Post('reset-password')
  @UseGuards(RateLimitGuard)
  @RateLimit('resetPassword')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Password reset successfully.')
  @ApiOperation({
    operationId: 'authResetPassword',
    summary: 'Reset password using a single-use opaque token',
    description:
      'Consumes the single-use token emailed by POST /auth/forgot-password, sets a new password, and revokes all existing sessions. Rate limited to 10 requests/15min/IP.',
  })
  @ApiResponse({
    status: 200,
    description: 'Password reset successful',
    type: ResetPasswordResponseDto,
  })
  @ApiErrorResponse(401, 'Reset token is invalid, malformed, already consumed, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(400, 'Password policy violation or password reuse', [
    'VALIDATION_ERROR',
    'AUTH_PASSWORD_REUSED',
  ])
  @ApiErrorResponse(429, 'Too many reset attempts from this IP', ['RATE_LIMIT_EXCEEDED'])
  async resetPassword(@Body() body: ResetPasswordRequestDto): Promise<ResetPasswordResponseDto> {
    return this.resetPasswordUseCase.execute({
      token: body.token,
      newPassword: body.newPassword,
    });
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, RateLimitGuard)
  @RateLimit('changePassword')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Password changed successfully.')
  @ApiOperation({
    operationId: 'authChangePassword',
    summary: 'Change password for the authenticated user',
    description:
      'Requires the current password. Rotates the session version, revoking all other device sessions, and issues a fresh access token for the current session. Rate limited to 10 requests/15min per authenticated user, to bound brute-forcing the current password with a stolen-but-still-valid access token.',
  })
  @ApiResponse({ status: 200, description: 'Password changed', type: ChangePasswordResponseDto })
  @ApiErrorResponse(
    401,
    'Current password is incorrect, or the access token is invalid or expired',
    ['AUTH_INVALID_CREDENTIALS', 'AUTH_INVALID_TOKEN', 'AUTH_EXPIRED_TOKEN'],
  )
  @ApiErrorResponse(403, 'Account locked, suspended, or email not verified', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_EMAIL_NOT_VERIFIED',
  ])
  @ApiErrorResponse(400, 'Password policy violation or password reuse', [
    'VALIDATION_ERROR',
    'AUTH_PASSWORD_REUSED',
  ])
  @ApiErrorResponse(429, 'Too many password-change attempts for this account', [
    'RATE_LIMIT_EXCEEDED',
  ])
  async changePassword(
    @Body() body: ChangePasswordRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<ChangePasswordResponseDto> {
    const result = await this.changePasswordUseCase.execute({
      actor,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    return this.toChangePasswordResponse(result);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({
    operationId: 'authLogout',
    summary: 'Revoke the current device session',
    description:
      'Revokes the device session tied to the current access token only; other sessions are unaffected.',
  })
  @ApiResponse({ status: 204, description: 'Current session revoked' })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Account locked, suspended, or email not verified', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_EMAIL_NOT_VERIFIED',
  ])
  async logout(@CurrentActor() actor: AuthenticatedActor): Promise<void> {
    await this.logoutCurrentSessionUseCase.execute({ actor });
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({
    operationId: 'authLogoutAll',
    summary: 'Revoke all device sessions and invalidate existing access tokens',
    description:
      'Revokes every device session for the authenticated user and bumps the session version, so already-issued access tokens on other devices stop passing SessionVersionGuard immediately.',
  })
  @ApiResponse({ status: 204, description: 'All sessions revoked' })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Account locked, suspended, or email not verified', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_EMAIL_NOT_VERIFIED',
  ])
  async logoutAll(@CurrentActor() actor: AuthenticatedActor): Promise<void> {
    await this.logoutAllDevicesUseCase.execute({ actor });
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Active sessions retrieved successfully.')
  @ApiOperation({
    operationId: 'authListSessions',
    summary: 'List active device sessions for the authenticated user',
    description:
      'Returns every non-revoked, non-expired device session, flagging which one is the current session.',
  })
  @ApiResponse({ status: 200, description: 'Session list', type: ListActiveSessionsResponseDto })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Account locked, suspended, or email not verified', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_EMAIL_NOT_VERIFIED',
  ])
  async listSessions(
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<ListActiveSessionsResponseDto> {
    const result = await this.listActiveSessionsUseCase.execute({ actor });
    return this.toSessionsResponse(result);
  }

  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({
    operationId: 'authRevokeSession',
    summary: 'Revoke a specific device session owned by the authenticated user',
    description:
      'Revokes the targeted session by id. Only the owning user may revoke their own sessions - a sessionId owned by another user, or an unknown sessionId, both resolve to 404.',
  })
  @ApiResponse({ status: 204, description: 'Session revoked' })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Account locked, suspended, or email not verified', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
    'AUTH_EMAIL_NOT_VERIFIED',
  ])
  @ApiErrorResponse(404, 'Session not found, or not owned by the authenticated user', [
    'AUTH_SESSION_NOT_FOUND',
  ])
  async revokeSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    await this.revokeSessionUseCase.execute({
      actor,
      targetSessionId: sessionId,
    });
  }

  private toLoginResponse(result: LoginResult): LoginResponseDto {
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
      refreshTokenExpiresAt: result.refreshTokenExpiresAt.toISOString(),
      user: result.user,
      organization: result.organization,
      sessionId: result.sessionId,
      sessionVersion: result.sessionVersion,
      permissionsVersion: result.permissionsVersion,
      actorType: result.actorType,
      requiresPasswordChange: result.requiresPasswordChange,
    };
  }

  private toRefreshResponse(result: RefreshSessionResult): RefreshSessionResponseDto {
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      tokenType: result.tokenType,
      accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
      refreshTokenExpiresAt: result.refreshTokenExpiresAt.toISOString(),
      sessionId: result.sessionId,
      sessionVersion: result.sessionVersion,
      permissionsVersion: result.permissionsVersion,
      actorType: result.actorType,
      issuedAt: result.issuedAt.toISOString(),
      serverTime: result.serverTime.toISOString(),
    };
  }

  private toChangePasswordResponse(result: ChangePasswordResult): ChangePasswordResponseDto {
    return {
      message: result.message,
      sessionVersion: result.sessionVersion,
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
    };
  }

  private toSessionsResponse(result: ListActiveSessionsResult): ListActiveSessionsResponseDto {
    return {
      sessions: result.sessions.map((session) => ({
        sessionId: session.sessionId,
        deviceName: session.deviceName,
        deviceType: session.deviceType,
        createdAt: session.createdAt.toISOString(),
        lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
        expiresAt: session.expiresAt.toISOString(),
        isCurrentSession: session.isCurrentSession,
        ipAddress: session.ipAddress,
      })),
    };
  }
}
