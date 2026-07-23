import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiExtraModels, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { StartCustomerRegistrationUseCase } from '../../application/use-cases/start-customer-registration.use-case';
import { ResendCustomerRegistrationUseCase } from '../../application/use-cases/resend-customer-registration.use-case';
import { VerifyCustomerRegistrationUseCase } from '../../application/use-cases/verify-customer-registration.use-case';
import { CompleteCustomerRegistrationUseCase } from '../../application/use-cases/complete-customer-registration.use-case';
import { CustomerLoginUseCase } from '../../application/use-cases/customer-login.use-case';
import { StartCustomerPasswordResetUseCase } from '../../application/use-cases/start-customer-password-reset.use-case';
import { ResendCustomerPasswordResetUseCase } from '../../application/use-cases/resend-customer-password-reset.use-case';
import { VerifyCustomerPasswordResetUseCase } from '../../application/use-cases/verify-customer-password-reset.use-case';
import { CompleteCustomerPasswordResetUseCase } from '../../application/use-cases/complete-customer-password-reset.use-case';
import { CustomerLoginResult } from '../../application/dto/customer-login.result';
import { RateLimit } from '../decorators/rate-limit.decorator';
import { RateLimitGuard } from '../guards/rate-limit.guard';
import { resolveClientIp } from '../utils/resolve-client-ip.util';
import { StartCustomerRegistrationRequestDto } from '../dto/start-customer-registration.request.dto';
import { ResendCustomerRegistrationRequestDto } from '../dto/resend-customer-registration.request.dto';
import { VerifyCustomerRegistrationRequestDto } from '../dto/verify-customer-registration.request.dto';
import { CompleteCustomerRegistrationRequestDto } from '../dto/complete-customer-registration.request.dto';
import { CompleteCustomerRegistrationResponseDto } from '../dto/complete-customer-registration.response.dto';
import { CustomerOtpResponseDto } from '../dto/customer-otp.response.dto';
import { CustomerLoginRequestDto } from '../dto/customer-login.request.dto';
import { CustomerLoginResponseDto } from '../dto/customer-login.response.dto';
import { StartCustomerPasswordResetRequestDto } from '../dto/start-customer-password-reset.request.dto';
import { ResendCustomerPasswordResetRequestDto } from '../dto/resend-customer-password-reset.request.dto';
import { VerifyCustomerPasswordResetRequestDto } from '../dto/verify-customer-password-reset.request.dto';
import { CompleteCustomerPasswordResetRequestDto } from '../dto/complete-customer-password-reset.request.dto';

/**
 * ADR-022 §"Final API Surface" (Decision #17). Every route here is public
 * and phone-first - no email, ever. Kept as its own controller (mirrors
 * this repository's one-controller-per-feature-surface convention) rather
 * than folding nine more routes into `AuthController`, which already owns
 * the unrelated, unchanged Owner/staff email-based surface.
 */
@ApiTags('Customer Authentication')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'auth/customer', version: '1' })
export class CustomerAuthController {
  constructor(
    private readonly startCustomerRegistrationUseCase: StartCustomerRegistrationUseCase,
    private readonly resendCustomerRegistrationUseCase: ResendCustomerRegistrationUseCase,
    private readonly verifyCustomerRegistrationUseCase: VerifyCustomerRegistrationUseCase,
    private readonly completeCustomerRegistrationUseCase: CompleteCustomerRegistrationUseCase,
    private readonly customerLoginUseCase: CustomerLoginUseCase,
    private readonly startCustomerPasswordResetUseCase: StartCustomerPasswordResetUseCase,
    private readonly resendCustomerPasswordResetUseCase: ResendCustomerPasswordResetUseCase,
    private readonly verifyCustomerPasswordResetUseCase: VerifyCustomerPasswordResetUseCase,
    private readonly completeCustomerPasswordResetUseCase: CompleteCustomerPasswordResetUseCase,
  ) {}

  @Post('register/start')
  @UseGuards(RateLimitGuard)
  @RateLimit('customerRegisterSend')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Verification code sent.')
  @ApiOperation({
    operationId: 'customerRegisterStart',
    summary: 'Start Customer registration (username + phone)',
    description:
      'Validates username/phone availability, normalizes the selected country code + national number to canonical E.164, and sends a 6-digit WhatsApp OTP via LightOTP. Does not create a User. At most one active pending registration per phone (a repeated call restarts it). Rate limited to 5 sends/hour/phone.',
  })
  @ApiResponse({ status: 200, description: 'OTP sent', type: CustomerOtpResponseDto })
  @ApiErrorResponse(400, 'Invalid username or phone/country combination', ['VALIDATION_ERROR'])
  @ApiErrorResponse(409, 'Username or phone already registered', ['CONFLICT'])
  @ApiErrorResponse(429, 'Too many send requests for this phone', ['RATE_LIMIT_EXCEEDED'])
  async start(@Body() body: StartCustomerRegistrationRequestDto): Promise<CustomerOtpResponseDto> {
    return this.startCustomerRegistrationUseCase.execute({
      username: body.username,
      countryCode: body.countryCode,
      phoneNumber: body.phoneNumber,
    });
  }

  @Post('register/resend')
  @UseGuards(RateLimitGuard)
  @RateLimit('customerRegisterSend')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Verification code sent.')
  @ApiOperation({
    operationId: 'customerRegisterResend',
    summary: 'Resend the WhatsApp OTP for a pending Customer registration',
    description:
      'Invalidates the previous OTP and issues a new one. Subject to the same 60s cooldown and 5/hour/phone limit as the initial send.',
  })
  @ApiResponse({ status: 200, description: 'OTP sent', type: CustomerOtpResponseDto })
  @ApiErrorResponse(400, 'No pending registration for this phone', ['AUTH_INVALID_OTP'])
  @ApiErrorResponse(429, 'Resend cooldown or hourly limit exceeded', ['RATE_LIMIT_EXCEEDED'])
  async resend(
    @Body() body: ResendCustomerRegistrationRequestDto,
  ): Promise<CustomerOtpResponseDto> {
    return this.resendCustomerRegistrationUseCase.execute({
      countryCode: body.countryCode,
      phoneNumber: body.phoneNumber,
    });
  }

  @Post('register/verify')
  @UseGuards(RateLimitGuard)
  @RateLimit('customerRegisterVerify')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Verification code accepted.')
  @ApiOperation({
    operationId: 'customerRegisterVerify',
    summary: 'Verify the WhatsApp OTP for a pending Customer registration',
    description:
      'Marks the pending registration verified. Does NOT create the User, set a password, or create a session. Max 5 incorrect attempts per issued OTP. Rate limited to 10 requests/15min per phone/IP.',
  })
  @ApiResponse({ status: 200, description: 'OTP verified', type: CustomerOtpResponseDto })
  @ApiErrorResponse(400, 'Invalid, expired, or attempts-exhausted OTP', [
    'AUTH_INVALID_OTP',
    'AUTH_EXPIRED_OTP',
    'AUTH_OTP_ATTEMPTS_EXHAUSTED',
  ])
  @ApiErrorResponse(429, 'Too many verification attempts', ['RATE_LIMIT_EXCEEDED'])
  async verify(
    @Body() body: VerifyCustomerRegistrationRequestDto,
  ): Promise<CustomerOtpResponseDto> {
    return this.verifyCustomerRegistrationUseCase.execute({
      countryCode: body.countryCode,
      phoneNumber: body.phoneNumber,
      code: body.code,
    });
  }

  @Post('register/complete')
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Registration completed successfully.')
  @ApiOperation({
    operationId: 'customerRegisterComplete',
    summary: 'Complete Customer registration by setting a password',
    description:
      'Requires a verified, unconsumed pending registration for this exact phone. Creates the real Customer User (username + canonical phone + password, no email) and consumes the pending registration atomically. Replay-safe.',
  })
  @ApiResponse({
    status: 201,
    description: 'Customer account created',
    type: CompleteCustomerRegistrationResponseDto,
  })
  @ApiErrorResponse(400, 'Registration not verified, or weak password', [
    'AUTH_REGISTRATION_NOT_VERIFIED',
    'VALIDATION_ERROR',
  ])
  @ApiErrorResponse(409, 'Username or phone already registered', ['CONFLICT'])
  async complete(
    @Body() body: CompleteCustomerRegistrationRequestDto,
  ): Promise<CompleteCustomerRegistrationResponseDto> {
    return this.completeCustomerRegistrationUseCase.execute({
      countryCode: body.countryCode,
      phoneNumber: body.phoneNumber,
      password: body.password,
    });
  }

  @Post('login')
  @UseGuards(RateLimitGuard)
  @RateLimit('login')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Login successful.')
  @ApiOperation({
    operationId: 'customerLogin',
    summary: 'Authenticate a Customer with phone and password',
    description:
      'Normalizes the selected country code + national number to canonical E.164 before lookup. A fully separate contract from the Owner/staff /auth/login route - never a discriminated union. Reuses the same session/JWT security as every other actor (DeviceSession, TokenFamily, refresh rotation).',
  })
  @ApiResponse({ status: 200, description: 'Login successful', type: CustomerLoginResponseDto })
  @ApiErrorResponse(401, 'Invalid credentials', ['AUTH_INVALID_CREDENTIALS'])
  @ApiErrorResponse(403, 'Account locked or suspended', [
    'AUTH_ACCOUNT_LOCKED',
    'AUTH_ACCOUNT_SUSPENDED',
  ])
  @ApiErrorResponse(409, 'Too many active sessions for this account', ['AUTH_TOO_MANY_SESSIONS'])
  @ApiErrorResponse(429, 'Too many login attempts from this IP', ['RATE_LIMIT_EXCEEDED'])
  async login(
    @Body() body: CustomerLoginRequestDto,
    @Req() request: Request,
  ): Promise<CustomerLoginResponseDto> {
    const result = await this.customerLoginUseCase.execute({
      countryCode: body.countryCode,
      phoneNumber: body.phoneNumber,
      password: body.password,
      deviceName: body.deviceName,
      deviceType: body.deviceType,
      ipAddress: resolveClientIp(request),
      userAgent: request.headers['user-agent'],
    });

    return this.toLoginResponse(result);
  }

  @Post('password-reset/start')
  @UseGuards(RateLimitGuard)
  @RateLimit('customerPasswordResetSend')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('If the phone number is valid, a verification code has been sent.')
  @ApiOperation({
    operationId: 'customerPasswordResetStart',
    summary: 'Start Customer password recovery (phone/WhatsApp OTP)',
    description:
      'Enumeration-resistant: always returns the same generic response regardless of whether the phone belongs to an account (mirrors /auth/forgot-password). Never reuses the Owner email-based reset flow. Rate limited to 5 sends/hour/phone.',
  })
  @ApiResponse({
    status: 200,
    description: 'Generic acceptance response',
    type: CustomerOtpResponseDto,
  })
  @ApiErrorResponse(429, 'Too many requests for this phone', ['RATE_LIMIT_EXCEEDED'])
  async startPasswordReset(
    @Body() body: StartCustomerPasswordResetRequestDto,
  ): Promise<CustomerOtpResponseDto> {
    return this.startCustomerPasswordResetUseCase.execute({
      countryCode: body.countryCode,
      phoneNumber: body.phoneNumber,
    });
  }

  @Post('password-reset/resend')
  @UseGuards(RateLimitGuard)
  @RateLimit('customerPasswordResetSend')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('If the phone number is valid, a verification code has been sent.')
  @ApiOperation({
    operationId: 'customerPasswordResetResend',
    summary: 'Resend the Customer password-recovery WhatsApp OTP',
    description:
      'Same enumeration-resistant, generic response as start. Subject to the same rate limits.',
  })
  @ApiResponse({
    status: 200,
    description: 'Generic acceptance response',
    type: CustomerOtpResponseDto,
  })
  @ApiErrorResponse(429, 'Too many requests for this phone', ['RATE_LIMIT_EXCEEDED'])
  async resendPasswordReset(
    @Body() body: ResendCustomerPasswordResetRequestDto,
  ): Promise<CustomerOtpResponseDto> {
    return this.resendCustomerPasswordResetUseCase.execute({
      countryCode: body.countryCode,
      phoneNumber: body.phoneNumber,
    });
  }

  @Post('password-reset/verify')
  @UseGuards(RateLimitGuard)
  @RateLimit('customerPasswordResetVerify')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Verification code accepted.')
  @ApiOperation({
    operationId: 'customerPasswordResetVerify',
    summary: 'Verify the Customer password-recovery WhatsApp OTP',
    description:
      'Establishes a verified, not-yet-consumed recovery state. Does NOT itself change the password. Rate limited to 10 requests/15min per phone/IP.',
  })
  @ApiResponse({ status: 200, description: 'OTP verified', type: CustomerOtpResponseDto })
  @ApiErrorResponse(400, 'Invalid, expired, or attempts-exhausted OTP', [
    'AUTH_INVALID_OTP',
    'AUTH_EXPIRED_OTP',
    'AUTH_OTP_ATTEMPTS_EXHAUSTED',
  ])
  @ApiErrorResponse(429, 'Too many verification attempts', ['RATE_LIMIT_EXCEEDED'])
  async verifyPasswordReset(
    @Body() body: VerifyCustomerPasswordResetRequestDto,
  ): Promise<CustomerOtpResponseDto> {
    return this.verifyCustomerPasswordResetUseCase.execute({
      countryCode: body.countryCode,
      phoneNumber: body.phoneNumber,
      code: body.code,
    });
  }

  @Post('password-reset/complete')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Password reset successfully.')
  @ApiOperation({
    operationId: 'customerPasswordResetComplete',
    summary: 'Complete Customer password recovery by setting a new password',
    description:
      'Requires a verified, unconsumed recovery challenge for this exact phone. Password changes only here. Revokes all existing sessions, same as the Owner/staff reset-password flow.',
  })
  @ApiResponse({ status: 200, description: 'Password reset', type: CustomerOtpResponseDto })
  @ApiErrorResponse(400, 'Recovery challenge not verified, or weak password', [
    'AUTH_REGISTRATION_NOT_VERIFIED',
    'VALIDATION_ERROR',
  ])
  async completePasswordReset(
    @Body() body: CompleteCustomerPasswordResetRequestDto,
  ): Promise<CustomerOtpResponseDto> {
    return this.completeCustomerPasswordResetUseCase.execute({
      countryCode: body.countryCode,
      phoneNumber: body.phoneNumber,
      newPassword: body.newPassword,
    });
  }

  private toLoginResponse(result: CustomerLoginResult): CustomerLoginResponseDto {
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
      refreshTokenExpiresAt: result.refreshTokenExpiresAt.toISOString(),
      user: result.user,
      sessionId: result.sessionId,
      sessionVersion: result.sessionVersion,
      permissionsVersion: result.permissionsVersion,
      actorType: result.actorType,
    };
  }
}
