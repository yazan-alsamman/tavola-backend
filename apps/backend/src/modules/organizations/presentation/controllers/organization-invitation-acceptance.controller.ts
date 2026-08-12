import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Post, Req } from '@nestjs/common';
import { ApiExtraModels, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { TokenService } from '@modules/authentication/domain/services/token-service.port';
import { TOKEN_SERVICE } from '@modules/authentication/domain/tokens/authentication.tokens';
import { AcceptOrganizationInvitationUseCase } from '../../application/use-cases/accept-organization-invitation.use-case';
import { AcceptOrganizationInvitationRequestDto } from '../dto/accept-organization-invitation.request.dto';
import { AcceptOrganizationInvitationResponseDto } from '../dto/organization-invitation.response.dto';

/**
 * Phase 19.8 (Owner Invite, ADR-036, Section 6/7/8). Deliberately public -
 * no `@UseGuards` - since the "no existing account" branch
 * (`AcceptOrganizationInvitationUseCase`, Section 8) must be reachable by an
 * anonymous, not-yet-registered invitee. Security rests entirely on the
 * opaque invitation token, not on this route's authentication state.
 *
 * `authenticatedUserId` is resolved leniently, NOT via `JwtAuthGuard` (which
 * fails closed on a missing/invalid header - wrong for a route that must
 * also serve anonymous callers): an absent `Authorization` header, or one
 * that fails to verify, is simply treated as "anonymous" here - never a
 * hard 401 for THIS route, since an invalid/expired token on an unrelated
 * endpoint carries no information this endpoint needs to react to. The use
 * case itself is what decides whether anonymity is actually acceptable for
 * the invitation being accepted (Section 7 requires a verified identity for
 * an already-registered email; Section 8 does not).
 */
@ApiTags('Organizations - Invitations')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'invitations', version: '1' })
export class OrganizationInvitationAcceptanceController {
  constructor(
    private readonly acceptInvitationUseCase: AcceptOrganizationInvitationUseCase,
    @Inject(TOKEN_SERVICE) private readonly tokenService: TokenService,
  ) {}

  @Post(':token/accept')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Invitation accepted successfully.')
  @ApiOperation({
    operationId: 'organizationsAcceptInvitation',
    summary:
      'Accept an Organization invitation (public - token-authenticated, not session-authenticated)',
    description:
      'If the invited email already has an account, the caller must be logged in as that exact account (send a Bearer token) - firstName/lastName/password are ignored in that case. If the invited email has no account yet, firstName/lastName/password are required and a new account is created atomically with the membership.',
  })
  @ApiParam({ name: 'token', description: 'The opaque invitation token from the emailed link.' })
  @ApiResponse({
    status: 200,
    description: 'Invitation accepted',
    type: AcceptOrganizationInvitationResponseDto,
  })
  @ApiErrorResponse(400, 'Invalid, already-used, or expired invitation link', [
    'INVALID_INVITATION_TOKEN',
    'EXPIRED_INVITATION_TOKEN',
  ])
  @ApiErrorResponse(401, 'Invited email already has an account - log in first', ['UNAUTHORIZED'])
  @ApiErrorResponse(403, 'Authenticated caller does not match the invited email', ['FORBIDDEN'])
  @ApiErrorResponse(
    409,
    'Organization is no longer available, already an active member, or a concurrent acceptance won the race',
    ['CONFLICT'],
  )
  async accept(
    @Param('token') token: string,
    @Body() body: AcceptOrganizationInvitationRequestDto,
    @Req() request: Request,
  ): Promise<AcceptOrganizationInvitationResponseDto> {
    const result = await this.acceptInvitationUseCase.execute({
      token,
      authenticatedUserId: this.resolveAuthenticatedUserId(request),
      firstName: body.firstName,
      lastName: body.lastName,
      password: body.password,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return result;
  }

  private resolveAuthenticatedUserId(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return null;
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      return null;
    }
    try {
      return this.tokenService.verifyAccessToken(token).sub;
    } catch {
      // Lenient by design - see class doc comment.
      return null;
    }
  }
}
