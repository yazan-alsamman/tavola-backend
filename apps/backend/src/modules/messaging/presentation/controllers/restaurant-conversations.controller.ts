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
import { ListRestaurantConversationsUseCase } from '../../application/use-cases/list-restaurant-conversations.use-case';
import { CursorPaginationQueryDto } from '../dto/cursor-pagination.query.dto';
import { ConversationListResponseDto } from '../dto/conversation-list.response.dto';
import { toConversationListResponse } from '../mappers/messaging-response.mapper';

const AUTHZ_DESCRIPTION =
  'Requires an OrganizationMember actor holding Owner or Admin role, OR an Employee holding the conversations:manage permission (branch-assignment constrained). Resolved inside the use case (DECISIONS.md D15) - the route carries only JwtAuthGuard/SessionVersionGuard, deliberately omitting OrganizationMemberGuard/PermissionsGuard, either of which would structurally deny one of the two legitimate actor types.';

/**
 * Phase 15.6 (Messaging). Staff-only list, separate from `ConversationsController`
 * (Customer/shared) exactly like `AnalyticsController`'s own
 * `restaurants/:restaurantId/analytics` precedent.
 */
@ApiTags('Messaging')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'restaurants/:restaurantId/conversations', version: '1' })
export class RestaurantConversationsController {
  constructor(
    private readonly listRestaurantConversationsUseCase: ListRestaurantConversationsUseCase,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @ResponseMessage('Restaurant conversations retrieved successfully.')
  @ApiOperation({
    operationId: 'restaurantConversationsList',
    summary: 'List conversations for a restaurant (staff inbox)',
    description: AUTHZ_DESCRIPTION,
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Conversations retrieved',
    type: ConversationListResponseDto,
  })
  @ApiErrorResponse(400, 'Invalid cursor or limit', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Actor lacks the required role/permission', ['PERMISSION_DENIED'])
  @ApiErrorResponse(404, 'restaurantId not found, or not accessible to the caller', ['NOT_FOUND'])
  async list(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Query() query: CursorPaginationQueryDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<ConversationListResponseDto> {
    const result = await this.listRestaurantConversationsUseCase.execute({
      actor,
      restaurantId,
      cursor: query.cursor,
      limit: query.limit,
    });
    return toConversationListResponse(result);
  }
}
