import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
import { SearchAvailabilityUseCase } from '../../application/use-cases/search-availability.use-case';
import { CreateReservationUseCase } from '../../application/use-cases/create-reservation.use-case';
import { ListMyReservationsUseCase } from '../../application/use-cases/list-my-reservations.use-case';
import { GetMyReservationUseCase } from '../../application/use-cases/get-my-reservation.use-case';
import { ApproveReservationUseCase } from '../../application/use-cases/approve-reservation.use-case';
import { RejectReservationUseCase } from '../../application/use-cases/reject-reservation.use-case';
import { CancelReservationUseCase } from '../../application/use-cases/cancel-reservation.use-case';
import { RescheduleReservationUseCase } from '../../application/use-cases/reschedule-reservation.use-case';
import { CompleteReservationUseCase } from '../../application/use-cases/complete-reservation.use-case';
import { MarkNoShowReservationUseCase } from '../../application/use-cases/mark-no-show-reservation.use-case';
import { MarkTableReadyReservationUseCase } from '../../application/use-cases/mark-table-ready-reservation.use-case';
import { SearchAvailabilityQueryDto } from '../dto/search-availability.query.dto';
import { CreateReservationRequestDto } from '../dto/create-reservation.request.dto';
import { CancelReservationRequestDto } from '../dto/cancel-reservation.request.dto';
import { RescheduleReservationRequestDto } from '../dto/reschedule-reservation.request.dto';
import { ListReservationsQueryDto } from '../dto/list-reservations.query.dto';
import { ReservationResponseDto } from '../dto/reservation.response.dto';
import { ReservationListResponseDto } from '../dto/reservation-list.response.dto';
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
    private readonly listMyReservationsUseCase: ListMyReservationsUseCase,
    private readonly getMyReservationUseCase: GetMyReservationUseCase,
    private readonly approveReservationUseCase: ApproveReservationUseCase,
    private readonly rejectReservationUseCase: RejectReservationUseCase,
    private readonly cancelReservationUseCase: CancelReservationUseCase,
    private readonly rescheduleReservationUseCase: RescheduleReservationUseCase,
    private readonly completeReservationUseCase: CompleteReservationUseCase,
    private readonly markNoShowReservationUseCase: MarkNoShowReservationUseCase,
    private readonly markTableReadyReservationUseCase: MarkTableReadyReservationUseCase,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Your reservations retrieved successfully.')
  @ApiOperation({
    operationId: 'reservationsListMine',
    summary: "List the authenticated Customer's own reservations",
    description:
      "Customer Restaurant Discovery & Public Read Surface. Ownership-only, no RBAC - always the caller's own reservations (from the JWT), paginated, newest-created first. A guest (Phone/WalkIn) reservation has no owning User and never appears here. Never exposes another Customer's reservation or any ReservationGuest data.",
  })
  @ApiResponse({
    status: 200,
    description: 'Your reservations retrieved',
    type: ReservationListResponseDto,
  })
  @ApiErrorResponse(400, 'Invalid page/limit', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  async listMine(
    @Query() query: ListReservationsQueryDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<ReservationListResponseDto> {
    const result = await this.listMyReservationsUseCase.execute({
      actor,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return {
      items: result.items.map(toReservationResponse),
      page: result.page,
      limit: result.limit,
      total: result.total,
    };
  }

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

  @Get(':id')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Reservation retrieved successfully.')
  @ApiOperation({
    operationId: 'reservationsGetMine',
    summary: "Get one of the authenticated Customer's own reservations by id",
    description:
      "Customer Restaurant Discovery & Public Read Surface. Ownership-only - an unknown, another Customer's, or guest-owned reservation collapses to the same 404 (IDOR-safe, never a distinguishing 403).",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Reservation retrieved', type: ReservationResponseDto })
  @ApiErrorResponse(400, 'id is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(404, 'Reservation not found, or does not belong to the caller', ['NOT_FOUND'])
  async getMine(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<ReservationResponseDto> {
    const result = await this.getMyReservationUseCase.execute({ actor, reservationId: id });
    return toReservationResponse(result);
  }

  @Post()
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Reservation created successfully.')
  @ApiOperation({
    operationId: 'reservationsCreate',
    summary: 'Create a reservation (Online, Phone, or WalkIn source)',
    description:
      "Phase 7.1 Scope Amendment (TASKS.md, 2026-07-20): status is Pending unless the branch restaurant's RestaurantSettings.autoApproval is true, in which case it is created directly as Approved. reservationEndTime is validated then persisted if supplied; if omitted, the backend derives it from the branch restaurant's default reservation duration. Protected at two independent layers per ADR-013 (an advisory lock and a database exclusion constraint). Phase 7.4 (TASKS.md, 2026-07-23): source Online remains reachable by any authenticated actor type for themselves, unchanged from Phase 7.1 (self-booking, not subject to branch scope or reservations:create). source Phone/WalkIn is reachable only by an Employee actor, for a ReservationGuest, holding reservations:create for the target Branch - the same shared endpoint dispatches on the actor's own verified type, never on request payload fields.",
  })
  @ApiResponse({ status: 201, description: 'Reservation created', type: ReservationResponseDto })
  @ApiErrorResponse(
    400,
    'Validation failure, invalid reservation time, party size exceeds capacity, or reservationGuest missing for a Phone/WalkIn source',
    ['VALIDATION_ERROR'],
  )
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(
    403,
    'Actor/source combination is not allowed, Employee lacks reservations:create, or is outside branch scope',
    ['FORBIDDEN', 'EMPLOYEE_BRANCH_NOT_ASSIGNED'],
  )
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
      source: body.source,
      reservationGuest: body.reservationGuest,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toReservationResponse(result);
  }

  @Post(':id/approve')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, PermissionsGuard)
  @RequirePermission('reservations:approve')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Reservation approved successfully.')
  @ApiOperation({
    operationId: 'reservationsApprove',
    summary: 'Approve a Pending reservation (Domain Action, Phase 7.2)',
    description:
      'Only a Pending reservation may be approved. Calls Table.reserve() atomically with the status transition (ADR-013 advisory lock + re-check, same mechanism as Create). Automatically rejects any other overlapping Pending reservation for the same table (no Table operation for those) - Reject and automatic rejection never call Table.release(), since a Pending reservation never reserved the table in the first place. Requires the reservations:approve permission and Employee branch scope.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Reservation approved', type: ReservationResponseDto })
  @ApiErrorResponse(400, 'Reservation is not currently Pending', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller lacks reservations:approve or is outside branch scope', [
    'FORBIDDEN',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(404, 'Reservation not found', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'A confirmed reservation now conflicts for this table/window', [
    'CONFLICT',
  ])
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedEmployeeActor,
    @Req() request: Request,
  ): Promise<ReservationResponseDto> {
    const result = await this.approveReservationUseCase.execute({
      actor,
      reservationId: id,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toReservationResponse(result);
  }

  @Post(':id/reject')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, PermissionsGuard)
  @RequirePermission('reservations:approve')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Reservation rejected successfully.')
  @ApiOperation({
    operationId: 'reservationsReject',
    summary: 'Reject a Pending reservation (Domain Action, Phase 7.2)',
    description:
      'Only a Pending reservation may be rejected. Performs NO Table operation (Phase 7.2 Architecture Correction: a Pending reservation never reserved the table, so there is nothing to release). Requires the reservations:approve permission and Employee branch scope.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Reservation rejected', type: ReservationResponseDto })
  @ApiErrorResponse(400, 'Reservation is not currently Pending', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller lacks reservations:approve or is outside branch scope', [
    'FORBIDDEN',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(404, 'Reservation not found', ['NOT_FOUND'])
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedEmployeeActor,
    @Req() request: Request,
  ): Promise<ReservationResponseDto> {
    const result = await this.rejectReservationUseCase.execute({
      actor,
      reservationId: id,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toReservationResponse(result);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Reservation cancelled successfully.')
  @ApiOperation({
    operationId: 'reservationsCancel',
    summary: 'Cancel a Pending or Approved reservation (Domain Action, Phase 7.3)',
    description:
      "Reachable from Pending or Approved, by either the reservation's own Customer (ownership-enforced) or a branch-scoped Employee holding reservations:cancel - one route, no PermissionsGuard (which would otherwise deny every Customer actor); actor branching happens inside the use case. Never blocked by the cancellation window - only flagged (withinCancellationWindow) on the resulting ReservationHistory row. Pending -> Cancelled performs no Table operation; Approved -> Cancelled calls Table.release() atomically, returning the table to Available.",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Reservation cancelled', type: ReservationResponseDto })
  @ApiErrorResponse(400, 'Reservation is not currently Pending or Approved', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Employee lacks reservations:cancel or is outside branch scope', [
    'FORBIDDEN',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(404, 'Reservation not found, or does not belong to the caller', ['NOT_FOUND'])
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelReservationRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<ReservationResponseDto> {
    const result = await this.cancelReservationUseCase.execute({
      actor,
      reservationId: id,
      reason: body.reason ?? null,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toReservationResponse(result);
  }

  @Post(':id/reschedule')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Reservation rescheduled successfully.')
  @ApiOperation({
    operationId: 'reservationsReschedule',
    summary: 'Reschedule a Pending or Approved reservation (Domain Action, Phase 7.3)',
    description:
      "An in-place modification, never a status transition - reachable from Pending or Approved, by either the reservation's own Customer or a branch-scoped Employee holding reservations:reschedule (same dual-actor pattern as Cancel). May change reservationStartTime/reservationEndTime/guests/tableId together; a new tableId must belong to the same Branch (cross-Branch targets 404). Blocked once the cancellation window before the CURRENT scheduled time has closed (ReservationRescheduleWindowExpiredException) - unlike Cancel, which is never blocked. An Approved reschedule to a different Table is atomic (ADR-023: two advisory locks acquired in deterministic sorted order, release old Table, reserve new Table) and auto-rejects any other overlapping Pending reservation for the target Table, exactly like Approval (Phase 7.2). A same-table Approved reschedule never releases/re-reserves the table. A Pending reschedule performs no Table operation at all.",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Reservation rescheduled',
    type: ReservationResponseDto,
  })
  @ApiErrorResponse(
    400,
    'Reservation is not currently Pending or Approved, invalid time, or no fields supplied',
    ['VALIDATION_ERROR'],
  )
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Employee lacks reservations:reschedule or is outside branch scope', [
    'FORBIDDEN',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(
    404,
    'Reservation or target Table not found (or belongs to a different Branch)',
    ['NOT_FOUND'],
  )
  @ApiErrorResponse(409, 'Reschedule window has closed, or a confirmed reservation now conflicts', [
    'RESERVATION_RESCHEDULE_WINDOW_EXPIRED',
    'CONFLICT',
  ])
  async reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RescheduleReservationRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<ReservationResponseDto> {
    const result = await this.rescheduleReservationUseCase.execute({
      actor,
      reservationId: id,
      tableId: body.tableId,
      reservationStartTime: body.reservationStartTime,
      reservationEndTime: body.reservationEndTime,
      guests: body.guests,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toReservationResponse(result);
  }

  @Post(':id/complete')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, PermissionsGuard)
  @RequirePermission('reservations:complete')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Reservation completed successfully.')
  @ApiOperation({
    operationId: 'reservationsComplete',
    summary: 'Mark an Approved reservation Completed (Domain Action, Phase 7.3)',
    description:
      'Staff-only (reservations:complete, branch-scoped) - a Customer cannot complete their own reservation. Only reachable once the scheduled service window has begun. Calls Table.release() atomically, returning the table directly to Available - never through TableStatus.Cleaning.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Reservation completed', type: ReservationResponseDto })
  @ApiErrorResponse(
    400,
    'Reservation is not currently Approved, or its scheduled service window has not begun',
    ['VALIDATION_ERROR'],
  )
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller lacks reservations:complete or is outside branch scope', [
    'FORBIDDEN',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(404, 'Reservation not found', ['NOT_FOUND'])
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedEmployeeActor,
    @Req() request: Request,
  ): Promise<ReservationResponseDto> {
    const result = await this.completeReservationUseCase.execute({
      actor,
      reservationId: id,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toReservationResponse(result);
  }

  @Post(':id/no-show')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, PermissionsGuard)
  @RequirePermission('reservations:noshow')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Reservation marked as No-Show successfully.')
  @ApiOperation({
    operationId: 'reservationsNoShow',
    summary: 'Mark an Approved reservation NoShow (Domain Action, Phase 7.3)',
    description:
      'Staff-only (reservations:noshow - a dedicated permission slug, never a reuse of reservations:approve; hyphen-free because PermissionSlug rejects hyphenated segments). Only reachable after the scheduled time has passed. Calls Table.release() atomically, identically to Complete. No-show customer restriction/counting policy remains a deferred future product decision, out of scope here.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Reservation marked NoShow',
    type: ReservationResponseDto,
  })
  @ApiErrorResponse(
    400,
    'Reservation is not currently Approved, or its scheduled time has not passed',
    ['VALIDATION_ERROR'],
  )
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller lacks reservations:noshow or is outside branch scope', [
    'FORBIDDEN',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(404, 'Reservation not found', ['NOT_FOUND'])
  async markNoShow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedEmployeeActor,
    @Req() request: Request,
  ): Promise<ReservationResponseDto> {
    const result = await this.markNoShowReservationUseCase.execute({
      actor,
      reservationId: id,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toReservationResponse(result);
  }

  @Post(':id/table-ready')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, PermissionsGuard)
  @RequirePermission('reservations:tableready')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Reservation marked table-ready successfully.')
  @ApiOperation({
    operationId: 'reservationsMarkTableReady',
    summary: "Mark an Approved reservation's table as ready (Operational Signal, Phase 7.6)",
    description:
      'Staff-only (reservations:tableready, branch-scoped) - not a status transition, status remains Approved and no Table operation is performed. Informational only for the front-of-house flow; may only be called once per reservation while it remains Approved.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Reservation marked table-ready',
    type: ReservationResponseDto,
  })
  @ApiErrorResponse(
    400,
    'Reservation is not currently Approved, or has already been marked table-ready',
    ['VALIDATION_ERROR'],
  )
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller lacks reservations:tableready or is outside branch scope', [
    'FORBIDDEN',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(404, 'Reservation not found', ['NOT_FOUND'])
  async markTableReady(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedEmployeeActor,
    @Req() request: Request,
  ): Promise<ReservationResponseDto> {
    const result = await this.markTableReadyReservationUseCase.execute({
      actor,
      reservationId: id,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toReservationResponse(result);
  }
}
