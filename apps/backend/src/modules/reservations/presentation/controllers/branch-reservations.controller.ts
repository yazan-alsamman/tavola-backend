import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
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
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { ListBranchReservationsUseCase } from '../../application/use-cases/list-branch-reservations.use-case';
import { BranchReservationsListResult } from '../../application/dto/branch-reservations-list.result';
import { ListBranchReservationsQueryDto } from '../dto/list-branch-reservations.query.dto';
import { BranchReservationListResponseDto } from '../dto/branch-reservation-list.response.dto';
import { toBranchReservationItemResponse } from './reservation-response.mapper';

/**
 * Restaurant Dashboard Calendar. Nested under `/restaurants/:restaurantId/
 * branches/:branchId` (matches `TablesController`'s own nesting precedent for
 * a branch-scoped collection resource) rather than the flat `ReservationsController`
 * (customer-ownership-scoped, a structurally different concern - see that
 * controller's own doc comment).
 *
 * One date-range endpoint serves all three calendar views the Restaurant
 * Dashboard needs - Day (`dateFrom` = `dateTo` = the selected day), Week
 * (`dateFrom`/`dateTo` = week start/end), and Month (`dateFrom`/`dateTo` =
 * month start/end) - rather than three separate `/calendar/day|week|month`
 * routes, per the frozen scope decision: prefer one properly-filtered
 * date-range endpoint over redundant view-specific routes.
 *
 * Employee actor only, `JwtAuthGuard` + `SessionVersionGuard` only - no
 * `PermissionsGuard`/`@RequirePermission` and no new permission slug
 * (TASKS.md Phase 8 §9 explicitly forbids inventing `reservations:read`;
 * existing `reservations:*` permissions remain mutation-only). Authorization
 * (actor-type gate, restaurant/branch scope) is resolved entirely inside
 * `ListBranchReservationsUseCase`, mirroring Cancel/Reschedule's own
 * "resolved inside the use case, not new guard composition" precedent.
 */
@ApiTags('Reservations')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'restaurants/:restaurantId/branches/:branchId/reservations', version: '1' })
export class BranchReservationsController {
  constructor(private readonly listBranchReservationsUseCase: ListBranchReservationsUseCase) {}

  @Get()
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Branch reservations retrieved successfully.')
  @ApiOperation({
    operationId: 'branchReservationsList',
    summary: "List a branch's reservations within a date range (Restaurant Dashboard Calendar)",
    description:
      "Employee actor only, branch-scoped (empty branchIds on the JWT = restaurant-wide scope). dateFrom/dateTo are both required (inclusive, against reservationDate) and serve Day/Week/Month calendar views from this single endpoint - see this controller's own doc comment. Ordered reservationStartTime ascending. Served by the existing (branchId, reservationDate, status) index - no N+1.",
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Branch reservations retrieved',
    type: BranchReservationListResponseDto,
  })
  @ApiErrorResponse(
    400,
    'Invalid page/limit/path parameters, dateFrom after dateTo, or range exceeds the maximum span',
    ['VALIDATION_ERROR'],
  )
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Employee, or is outside branch scope', [
    'FORBIDDEN',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(
    404,
    'Restaurant not found, or branch not found (or belongs to another restaurant)',
    ['NOT_FOUND'],
  )
  async list(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListBranchReservationsQueryDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<BranchReservationListResponseDto> {
    const result = await this.listBranchReservationsUseCase.execute({
      actor,
      restaurantId,
      branchId,
      dateFrom: new Date(query.dateFrom),
      dateTo: new Date(query.dateTo),
      status: query.status,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return this.toListResponse(result);
  }

  private toListResponse(result: BranchReservationsListResult): BranchReservationListResponseDto {
    return {
      items: result.items.map(toBranchReservationItemResponse),
      page: result.page,
      limit: result.limit,
      total: result.total,
    };
  }
}
