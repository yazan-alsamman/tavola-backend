import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExtraModels, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ApiErrorResponse } from '@common/decorators/api-error-response.decorator';
import { ErrorResponseDto } from '@common/dto/error-response.dto';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { GetReservationsSummaryUseCase } from '../../application/use-cases/get-reservations-summary.use-case';
import { AnalyticsDateRangeQueryDto } from '../dto/analytics-date-range.query.dto';
import { ReservationSummaryResponseDto } from '../dto/reservation-summary.response.dto';

/**
 * Phase 14 (Analytics, architecture frozen 2026-07-28, ADR-028 Decision #6).
 * Organization-scope aggregation - Owner/Admin only (an Employee is always
 * scoped to exactly one Restaurant, so no Employee path exists here). No
 * `:organizationId` route parameter - `organizationId` always comes from the
 * JWT via `TenantContextService`, matching every other authenticated
 * resource in this codebase (`GET /restaurants` has no `organizationId`
 * segment either; no `OrganizationsController`/`/organizations/:id/...`
 * precedent exists anywhere in this codebase to follow instead). Only the
 * non-bucketed Reservation Summary is exposed at this scope - Peak
 * Hours/trends remain Branch-scoped only (ADR-028 Decision #4), since an
 * Organization can span multiple Branch timezones and must never silently
 * combine their local calendar buckets into one series.
 */
@ApiTags('Analytics')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'organization/analytics', version: '1' })
export class OrganizationAnalyticsController {
  constructor(private readonly getReservationsSummaryUseCase: GetReservationsSummaryUseCase) {}

  @Get('reservations/summary')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @ResponseMessage('Organization reservation summary retrieved successfully.')
  @ApiOperation({
    operationId: 'analyticsOrganizationReservationsSummary',
    summary: 'Reservation summary aggregated across every Restaurant in the caller organization',
    description:
      'Requires an OrganizationMember actor holding Owner or Admin role. organizationId always comes from the JWT, never a route/query parameter.',
  })
  @ApiResponse({
    status: 200,
    description: 'Organization-wide reservation summary',
    type: ReservationSummaryResponseDto,
  })
  @ApiErrorResponse(400, 'Invalid or contradictory date range', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  async getOrganizationReservationsSummary(
    @Query() query: AnalyticsDateRangeQueryDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<ReservationSummaryResponseDto> {
    return this.getReservationsSummaryUseCase.executeForOrganization({
      actor,
      range: { range: query.range, dateFrom: query.dateFrom, dateTo: query.dateTo },
    });
  }
}
