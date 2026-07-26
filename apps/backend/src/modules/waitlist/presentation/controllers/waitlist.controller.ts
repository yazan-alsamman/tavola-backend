import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import {
  AuthenticatedActor,
  AuthenticatedEmployeeActor,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { PermissionsGuard } from '@modules/authorization/presentation/guards/permissions.guard';
import { RequirePermission } from '@modules/authorization/presentation/decorators/require-permission.decorator';
import { JoinWaitlistUseCase } from '../../application/use-cases/join-waitlist.use-case';
import { CancelWaitlistEntryUseCase } from '../../application/use-cases/cancel-waitlist-entry.use-case';
import { PromoteWaitlistEntryUseCase } from '../../application/use-cases/promote-waitlist-entry.use-case';
import { JoinWaitlistRequestDto } from '../dto/join-waitlist.request.dto';
import { WaitlistEntryResponseDto } from '../dto/waitlist-entry.response.dto';
import { toWaitlistEntryResponse } from './waitlist-response.mapper';

/**
 * Phase 7.5 (Reservation Waitlist, ADR-019, architecture frozen 2026-07-24) -
 * API surface frozen to exactly 3 endpoints (freeze item 7): no list,
 * reorder, admin dashboard, or analytics endpoints. `POST /waitlist` is
 * guard-light (`JwtAuthGuard`/`SessionVersionGuard` only), mirroring
 * `POST /reservations` exactly - reachable by a Customer joining for
 * themselves or an Employee joining on behalf of a guest, dispatched inside
 * the use case. `POST /waitlist/:id/cancel` is the same dual-actor pattern
 * as `POST /reservations/:id/cancel`. `POST /waitlist/:id/promote` is
 * staff-only (`PermissionsGuard` + `reservations:waitlist`) - Customers
 * cannot reach it at all (freeze item 8).
 */
@ApiTags('Waitlist')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'waitlist', version: '1' })
export class WaitlistController {
  constructor(
    private readonly joinWaitlistUseCase: JoinWaitlistUseCase,
    private readonly cancelWaitlistEntryUseCase: CancelWaitlistEntryUseCase,
    private readonly promoteWaitlistEntryUseCase: PromoteWaitlistEntryUseCase,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Joined waitlist successfully.')
  @ApiOperation({
    operationId: 'waitlistJoin',
    summary: 'Join a branch waitlist for a preferred date/time',
    description:
      'preferredDate and preferredTimeFrom are both required and, together with Branch.timezone, deterministically drive promotion - preferredTimeFrom is the authoritative requested Reservation start time-of-day on promotion (Phase 7.5 final promotion-slot-semantics decision, 2026-07-24), not a soft preference. preferredTimeTo remains optional/non-authoritative. reservationGuest is reachable only by an Employee actor holding reservations:waitlist for the target branch; a Customer actor always joins for themselves.',
  })
  @ApiResponse({
    status: 201,
    description: 'Waitlist entry created',
    type: WaitlistEntryResponseDto,
  })
  @ApiErrorResponse(
    400,
    'Validation failure, invalid preferredDate/preferredTimeFrom, derived start time already in the past, or reservationGuest missing/not allowed',
    ['VALIDATION_ERROR'],
  )
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Employee lacks reservations:waitlist or is outside branch scope', [
    'FORBIDDEN',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(404, 'Branch not found', ['NOT_FOUND'])
  async join(
    @Body() body: JoinWaitlistRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<WaitlistEntryResponseDto> {
    const result = await this.joinWaitlistUseCase.execute({
      actor,
      branchId: body.branchId,
      partySize: body.partySize,
      preferredDate: body.preferredDate,
      preferredTimeFrom: body.preferredTimeFrom,
      preferredTimeTo: body.preferredTimeTo,
      notes: body.notes ?? null,
      reservationGuest: body.reservationGuest,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toWaitlistEntryResponse(result);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Waitlist entry cancelled successfully.')
  @ApiOperation({
    operationId: 'waitlistCancel',
    summary: 'Cancel a Waiting or Notified waitlist entry',
    description:
      "Reachable from Waiting or Notified, by either the entry's own Customer (ownership-enforced) or a branch-scoped Employee holding reservations:waitlist - one route, no PermissionsGuard, mirroring POST /reservations/:id/cancel exactly.",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Waitlist entry cancelled',
    type: WaitlistEntryResponseDto,
  })
  @ApiErrorResponse(400, 'Entry is not currently Waiting or Notified', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Employee lacks reservations:waitlist or is outside branch scope', [
    'FORBIDDEN',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(404, 'Waitlist entry not found, or does not belong to the caller', [
    'NOT_FOUND',
  ])
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<WaitlistEntryResponseDto> {
    const result = await this.cancelWaitlistEntryUseCase.execute({
      actor,
      entryId: id,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toWaitlistEntryResponse(result);
  }

  @Post(':id/promote')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, PermissionsGuard)
  @RequirePermission('reservations:waitlist')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Waitlist entry promoted successfully.')
  @ApiOperation({
    operationId: 'waitlistPromote',
    summary: 'Manually promote a Waiting or Notified waitlist entry (Domain Action)',
    description:
      "Staff-only (reservations:waitlist, branch-scoped) - a Customer cannot promote their own entry. Uses the entry's own preferredDate/preferredTimeFrom to derive the requested Reservation window and searches for a currently available Table (never the request body) - the same slot-derivation and table-search as automatic promotion. Reuses the low-level Reservation creation/concurrency infrastructure (ADR-013), never CreateReservationUseCase.",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Waitlist entry promoted (Converted)',
    type: WaitlistEntryResponseDto,
  })
  @ApiErrorResponse(400, 'Entry is no longer eligible for promotion', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller lacks reservations:waitlist or is outside branch scope', [
    'FORBIDDEN',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(404, 'Waitlist entry not found', ['NOT_FOUND'])
  @ApiErrorResponse(
    409,
    'No table with sufficient capacity is currently available for this entry',
    ['CONFLICT'],
  )
  async promote(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedEmployeeActor,
    @Req() request: Request,
  ): Promise<WaitlistEntryResponseDto> {
    const result = await this.promoteWaitlistEntryUseCase.execute({
      actor,
      entryId: id,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toWaitlistEntryResponse(result);
  }
}
