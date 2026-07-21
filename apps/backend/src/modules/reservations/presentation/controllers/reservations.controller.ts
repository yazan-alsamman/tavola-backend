import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { SearchAvailabilityUseCase } from '../../application/use-cases/search-availability.use-case';
import { CreateReservationUseCase } from '../../application/use-cases/create-reservation.use-case';
import { SearchAvailabilityQueryDto } from '../dto/search-availability.query.dto';
import { CreateReservationRequestDto } from '../dto/create-reservation.request.dto';
import { ReservationResponseDto } from '../dto/reservation.response.dto';
import { TableAvailabilityResponseDto } from '../dto/table-availability.response.dto';
import { toReservationResponse, toTableAvailabilityResponse } from './reservation-response.mapper';

/**
 * Phase 7.1 (Reservation Core) - customer-facing, flat `reservations`
 * resource. Guarded only by `JwtAuthGuard`/`SessionVersionGuard` - no
 * organization/employee-specific guard - mirroring `UsersController`'s own
 * "own resource" precedent (AUTHORIZATION_ARCHITECTURE.md's Customer
 * ownership rule: `resource.userId === principal.userId`, enforced here by
 * `CreateReservationUseCase` always setting `userId`/`createdBy` from the
 * caller's own JWT, never a client-supplied value). Search Availability has
 * no tenant scope at all (any authenticated actor may search any branch,
 * matching a public discovery capability).
 */
@ApiTags('Reservations')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'reservations', version: '1' })
export class ReservationsController {
  constructor(
    private readonly searchAvailabilityUseCase: SearchAvailabilityUseCase,
    private readonly createReservationUseCase: CreateReservationUseCase,
  ) {}

  @Get('availability')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Availability retrieved successfully.')
  @ApiOperation({
    operationId: 'reservationsSearchAvailability',
    summary: 'Search table availability for a branch (informational only)',
    description:
      'Phase 7.1 Availability Search Contract: every table matching the search criteria is returned, never hidden - each carries an isAvailable indicator. A table already holding a Pending/Approved reservation for the requested window remains visible, marked unavailable. This endpoint never performs a conflict check and reserves nothing - Reservation creation (POST /reservations) remains the sole authoritative conflict check (ADR-013).',
  })
  @ApiResponse({
    status: 200,
    description: 'Matching tables',
    type: [TableAvailabilityResponseDto],
  })
  @ApiErrorResponse(400, 'Validation failure (invalid field format)', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(404, 'Branch not found', ['NOT_FOUND'])
  async searchAvailability(
    @Query() query: SearchAvailabilityQueryDto,
  ): Promise<TableAvailabilityResponseDto[]> {
    const results = await this.searchAvailabilityUseCase.execute({
      branchId: query.branchId,
      reservationStartTime: query.reservationStartTime,
      reservationEndTime: query.reservationEndTime,
      partySize: query.partySize,
    });
    return results.map(toTableAvailabilityResponse);
  }

  @Post()
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Reservation created successfully.')
  @ApiOperation({
    operationId: 'reservationsCreate',
    summary: 'Create a reservation (Online source, always Pending)',
    description:
      "Phase 7.1 Scope Amendment (TASKS.md, 2026-07-20): always produces status Pending, regardless of the restaurant's auto-approval setting - Approval is a later sub-phase. reservationEndTime is validated then persisted if supplied; if omitted, the backend derives it from the branch restaurant's default reservation duration - the backend is the single source of truth for the final persisted value either way. Protected at two independent layers per ADR-013 (an advisory lock and a database exclusion constraint), though neither can currently reject anything since this phase never produces a confirmed (Approved/Completed/NoShow) reservation.",
  })
  @ApiResponse({ status: 201, description: 'Reservation created', type: ReservationResponseDto })
  @ApiErrorResponse(
    400,
    'Validation failure, invalid reservation time, or party size exceeds capacity',
    ['VALIDATION_ERROR'],
  )
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(404, 'Branch or table not found (or table belongs to a different branch)', [
    'NOT_FOUND',
  ])
  @ApiErrorResponse(
    409,
    'Table is not currently available, or a confirmed reservation now conflicts',
    ['CONFLICT'],
  )
  async create(
    @Body() body: CreateReservationRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<ReservationResponseDto> {
    const result = await this.createReservationUseCase.execute({
      actor,
      branchId: body.branchId,
      tableId: body.tableId,
      reservationStartTime: body.reservationStartTime,
      reservationEndTime: body.reservationEndTime,
      guests: body.guests,
      notes: body.notes ?? null,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toReservationResponse(result);
  }
}
