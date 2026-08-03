import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
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
import { GetReservationsSummaryUseCase } from '../../application/use-cases/get-reservations-summary.use-case';
import { GetReservationsTrendsUseCase } from '../../application/use-cases/get-reservations-trends.use-case';
import { GetPeakHoursUseCase } from '../../application/use-cases/get-peak-hours.use-case';
import { GetCustomerInsightsUseCase } from '../../application/use-cases/get-customer-insights.use-case';
import { GetWaitlistAnalyticsUseCase } from '../../application/use-cases/get-waitlist-analytics.use-case';
import { GetReviewsSummaryUseCase } from '../../application/use-cases/get-reviews-summary.use-case';
import {
  AnalyticsDateRangeQueryDto,
  AnalyticsDateRangeWithBranchQueryDto,
} from '../dto/analytics-date-range.query.dto';
import { ReservationSummaryResponseDto } from '../dto/reservation-summary.response.dto';
import { ReservationTrendsResponseDto } from '../dto/reservation-trends.response.dto';
import { PeakHoursResponseDto } from '../dto/peak-hours.response.dto';
import { CustomerInsightsResponseDto } from '../dto/customer-insights.response.dto';
import { WaitlistAnalyticsResponseDto } from '../dto/waitlist-analytics.response.dto';
import { ReviewsSummaryResponseDto } from '../dto/reviews-summary.response.dto';

const AUTHZ_DESCRIPTION =
  'Requires an OrganizationMember actor holding Owner or Admin role, OR an Employee holding the reports:view permission (branch-assignment constrained). Resolved inside the use case (ADR-028 Decision #5) - the route carries only JwtAuthGuard/SessionVersionGuard, deliberately omitting OrganizationMemberGuard/PermissionsGuard, either of which would structurally deny one of the two legitimate actor types.';

/**
 * Phase 14 (Analytics, architecture frozen 2026-07-28, ADR-028). Read-only -
 * no mutation routes. Restaurant scope aggregates all Branches (optionally
 * narrowed via `?branchId=`); Branch-scoped routes (`trends`, `peak-hours`)
 * require an explicit `:branchId` because their series are Branch-local
 * timezone buckets that must never be silently combined across Branches
 * (ADR-028 Decision #4). Dual-actor authorization is resolved inside each
 * use case via `assertActorCanViewAnalytics` - never `OrganizationMemberGuard`/
 * `PermissionsGuard` on these routes, matching ADR-026's own precedent.
 */
@ApiTags('Analytics')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'restaurants/:restaurantId/analytics', version: '1' })
export class AnalyticsController {
  constructor(
    private readonly getReservationsSummaryUseCase: GetReservationsSummaryUseCase,
    private readonly getReservationsTrendsUseCase: GetReservationsTrendsUseCase,
    private readonly getPeakHoursUseCase: GetPeakHoursUseCase,
    private readonly getCustomerInsightsUseCase: GetCustomerInsightsUseCase,
    private readonly getWaitlistAnalyticsUseCase: GetWaitlistAnalyticsUseCase,
    private readonly getReviewsSummaryUseCase: GetReviewsSummaryUseCase,
  ) {}

  @Get('reservations/summary')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @ResponseMessage('Reservation summary retrieved successfully.')
  @ApiOperation({
    operationId: 'analyticsReservationsSummary',
    summary: 'Reservation status counts, source breakdown, rates, average party size',
    description: AUTHZ_DESCRIPTION,
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Reservation summary',
    type: ReservationSummaryResponseDto,
  })
  @ApiErrorResponse(400, 'Invalid or contradictory date range', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller lacks Owner/Admin role or reports:view permission', [
    'FORBIDDEN',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(
    404,
    'Restaurant or Branch not found (or belongs to another organization/restaurant)',
    ['NOT_FOUND'],
  )
  async getReservationsSummary(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Query() query: AnalyticsDateRangeWithBranchQueryDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<ReservationSummaryResponseDto> {
    return this.getReservationsSummaryUseCase.executeForRestaurant({
      actor,
      restaurantId,
      branchId: query.branchId,
      range: { range: query.range, dateFrom: query.dateFrom, dateTo: query.dateTo },
    });
  }

  @Get('branches/:branchId/reservations/trends')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @ResponseMessage('Reservation trends retrieved successfully.')
  @ApiOperation({
    operationId: 'analyticsReservationsTrends',
    summary: 'Service-day trend and booking-created trend (Branch-local, zero-filled)',
    description: AUTHZ_DESCRIPTION,
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Reservation trends',
    type: ReservationTrendsResponseDto,
  })
  @ApiErrorResponse(400, 'Invalid or contradictory date range', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller lacks Owner/Admin role or reports:view permission', [
    'FORBIDDEN',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(404, 'Restaurant or Branch not found', ['NOT_FOUND'])
  async getReservationsTrends(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: AnalyticsDateRangeQueryDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<ReservationTrendsResponseDto> {
    return this.getReservationsTrendsUseCase.execute({
      actor,
      restaurantId,
      branchId,
      range: { range: query.range, dateFrom: query.dateFrom, dateTo: query.dateTo },
    });
  }

  @Get('branches/:branchId/peak-hours')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @ResponseMessage('Peak hours retrieved successfully.')
  @ApiOperation({
    operationId: 'analyticsPeakHours',
    summary: 'Reservation starts per 60-minute Branch-local hour bucket (not occupancy)',
    description: AUTHZ_DESCRIPTION,
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Peak hours', type: PeakHoursResponseDto })
  @ApiErrorResponse(400, 'Invalid or contradictory date range', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller lacks Owner/Admin role or reports:view permission', [
    'FORBIDDEN',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(404, 'Restaurant or Branch not found', ['NOT_FOUND'])
  async getPeakHours(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: AnalyticsDateRangeQueryDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<PeakHoursResponseDto> {
    return this.getPeakHoursUseCase.execute({
      actor,
      restaurantId,
      branchId,
      range: { range: query.range, dateFrom: query.dateFrom, dateTo: query.dateTo },
    });
  }

  @Get('customers')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @ResponseMessage('Customer insights retrieved successfully.')
  @ApiOperation({
    operationId: 'analyticsCustomerInsights',
    summary: 'Unique/returning registered customers, guest-backed count, average party size',
    description: AUTHZ_DESCRIPTION,
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Customer insights', type: CustomerInsightsResponseDto })
  @ApiErrorResponse(400, 'Invalid or contradictory date range', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller lacks Owner/Admin role or reports:view permission', [
    'FORBIDDEN',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(404, 'Restaurant or Branch not found', ['NOT_FOUND'])
  async getCustomerInsights(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Query() query: AnalyticsDateRangeWithBranchQueryDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<CustomerInsightsResponseDto> {
    return this.getCustomerInsightsUseCase.execute({
      actor,
      restaurantId,
      branchId: query.branchId,
      range: { range: query.range, dateFrom: query.dateFrom, dateTo: query.dateTo },
    });
  }

  @Get('waitlist')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @ResponseMessage('Waitlist analytics retrieved successfully.')
  @ApiOperation({
    operationId: 'analyticsWaitlist',
    summary: 'Waitlist entry/outcome counts and closed-entry conversion rate',
    description: AUTHZ_DESCRIPTION,
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Waitlist analytics',
    type: WaitlistAnalyticsResponseDto,
  })
  @ApiErrorResponse(400, 'Invalid or contradictory date range', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller lacks Owner/Admin role or reports:view permission', [
    'FORBIDDEN',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(404, 'Restaurant or Branch not found', ['NOT_FOUND'])
  async getWaitlistAnalytics(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Query() query: AnalyticsDateRangeWithBranchQueryDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<WaitlistAnalyticsResponseDto> {
    return this.getWaitlistAnalyticsUseCase.execute({
      actor,
      restaurantId,
      branchId: query.branchId,
      range: { range: query.range, dateFrom: query.dateFrom, dateTo: query.dateTo },
    });
  }

  @Get('reviews-summary')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @ResponseMessage('Review summary retrieved successfully.')
  @ApiOperation({
    operationId: 'analyticsReviewsSummary',
    summary: 'Active review count and average rating (Phase 10 semantics, no new review analytics)',
    description: AUTHZ_DESCRIPTION,
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Review summary', type: ReviewsSummaryResponseDto })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller lacks Owner/Admin role or reports:view permission', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found', ['NOT_FOUND'])
  async getReviewsSummary(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<ReviewsSummaryResponseDto> {
    return this.getReviewsSummaryUseCase.execute({ actor, restaurantId });
  }
}
