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
import { ListBranchWaitlistUseCase } from '../../application/use-cases/list-branch-waitlist.use-case';
import { ListBranchWaitlistQueryDto } from '../dto/list-branch-waitlist.query.dto';
import { BranchWaitlistListResponseDto } from '../dto/branch-waitlist.response.dto';
import { toWaitlistEntryResponse } from './waitlist-response.mapper';

/**
 * Restaurant Dashboard waitlist board. Nested under the branch like
 * `BranchReservationsController`; authorization (Owner/Admin, or an Employee
 * holding reservations:waitlist within branch scope) is resolved inside
 * `ListBranchWaitlistUseCase`, so only the authentication guards apply here.
 */
@ApiTags('Waitlist')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'restaurants/:restaurantId/branches/:branchId/waitlist', version: '1' })
export class BranchWaitlistController {
  constructor(private readonly listBranchWaitlistUseCase: ListBranchWaitlistUseCase) {}

  @Get()
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Branch waitlist retrieved successfully.')
  @ApiOperation({
    operationId: 'branchWaitlistList',
    summary: "List a branch's waitlist for one day (Restaurant Dashboard)",
    description:
      'Owner/Admin of the owning organization, or an Employee holding reservations:waitlist within branch scope. Ordered by queue position. Each item includes who is waiting (app customer or staff-added guest) with name and phone. At most 500 entries.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'branchId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Branch waitlist retrieved',
    type: BranchWaitlistListResponseDto,
  })
  @ApiErrorResponse(400, 'Invalid date, status, or path parameters', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller lacks reservations:waitlist or is outside branch scope', [
    'FORBIDDEN',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(404, 'Branch not found (or belongs to another restaurant)', ['NOT_FOUND'])
  async list(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: ListBranchWaitlistQueryDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<BranchWaitlistListResponseDto> {
    const items = await this.listBranchWaitlistUseCase.execute({
      actor,
      restaurantId,
      branchId,
      preferredDate: new Date(`${query.date}T00:00:00.000Z`),
      status: query.status,
    });
    return {
      items: items.map((item) => ({
        ...toWaitlistEntryResponse(item),
        customer: {
          type: item.customer.type,
          name: item.customer.name,
          phone: item.customer.phone,
        },
      })),
    };
  }
}
