import {
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
import { PlatformAdminGuard } from '@modules/platform-admin/presentation/guards/platform-admin.guard';
import { PlatformAdminRoleGuard } from '@modules/platform-admin/presentation/guards/platform-admin-role.guard';
import { RequirePlatformAdminRole } from '@modules/platform-admin/presentation/decorators/require-platform-admin-role.decorator';
import { CurrentPlatformAdmin } from '@modules/platform-admin/presentation/decorators/current-platform-admin.decorator';
import { PlatformAdminActor } from '@modules/platform-admin/application/dto/platform-admin-actor.dto';
import { PlatformAdminRole } from '@modules/platform-admin/domain/enums/platform-admin.enums';
import { PlatformAdminSuspendRestaurantUseCase } from '../../application/use-cases/platform-admin-suspend-restaurant.use-case';
import { PlatformAdminReactivateRestaurantUseCase } from '../../application/use-cases/platform-admin-reactivate-restaurant.use-case';
import { PlatformAdminDeleteRestaurantUseCase } from '../../application/use-cases/platform-admin-delete-restaurant.use-case';
import { PlatformAdminRestoreRestaurantUseCase } from '../../application/use-cases/platform-admin-restore-restaurant.use-case';
import { SearchRestaurantsUseCase } from '../../application/use-cases/search-restaurants.use-case';
import { PlatformAdminRestaurantResponseDto } from '../dto/platform-admin-restaurant.response.dto';
import { SearchRestaurantsQueryDto } from '../dto/search-restaurants.query.dto';
import { RestaurantLookupListResponseDto } from '../dto/restaurant-lookup.response.dto';
import { toPlatformAdminRestaurantResponse } from './platform-admin-restaurant-response.mapper';

/**
 * ADR-034 §3/§13, API_GUIDELINES.md's Platform Back Office Route Ownership
 * table: `/platform-admin/restaurants/:id/{suspend,reactivate,delete,restore}`
 * (Pattern 1, after an internal Pattern 2 resolve - see
 * `PlatformAdminSuspendRestaurantUseCase`'s doc comment) plus
 * `GET /platform-admin/restaurants` (Pattern 2, narrow lookup/search, Phase
 * 19.7). The four lifecycle routes are PlatformAdmin-tier only
 * (destructive/state-mutating); the lookup route is read-only, available to
 * both Platform tiers (ADR-034 §11).
 */
@ApiTags('Platform Admin - Restaurants')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'platform-admin/restaurants', version: '1' })
export class PlatformAdminRestaurantsController {
  constructor(
    private readonly suspendRestaurantUseCase: PlatformAdminSuspendRestaurantUseCase,
    private readonly reactivateRestaurantUseCase: PlatformAdminReactivateRestaurantUseCase,
    private readonly deleteRestaurantUseCase: PlatformAdminDeleteRestaurantUseCase,
    private readonly restoreRestaurantUseCase: PlatformAdminRestoreRestaurantUseCase,
    private readonly searchRestaurantsUseCase: SearchRestaurantsUseCase,
  ) {}

  @Get()
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin, PlatformAdminRole.PlatformSupport)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurants retrieved successfully.')
  @ApiOperation({
    operationId: 'platformAdminSearchRestaurants',
    summary: 'Narrow lookup of Restaurants by name/slug (PlatformAdmin or PlatformSupport)',
    description:
      'ADR-034 §13 - a support tool, not a search engine. Case-insensitive partial match on name or slug; q omitted lists every Restaurant. Includes soft-deleted rows.',
  })
  @ApiResponse({
    status: 200,
    description: 'Restaurants retrieved',
    type: RestaurantLookupListResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active Platform Admin', ['FORBIDDEN'])
  async search(
    @Query() query: SearchRestaurantsQueryDto,
  ): Promise<RestaurantLookupListResponseDto> {
    const result = await this.searchRestaurantsUseCase.execute({
      q: query.q ?? '',
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return {
      items: result.items.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        name: row.name,
        slug: row.slug,
        status: row.status,
        deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  @Post(':id/suspend')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurant suspended successfully.')
  @ApiOperation({
    operationId: 'platformAdminSuspendRestaurant',
    summary: 'Suspend a Restaurant across any Organization (PlatformAdmin only)',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Restaurant id' })
  @ApiResponse({
    status: 200,
    description: 'Restaurant suspended',
    type: PlatformAdminRestaurantResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found', ['NOT_FOUND'])
  async suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<PlatformAdminRestaurantResponseDto> {
    const result = await this.suspendRestaurantUseCase.execute({
      restaurantId: id,
      actorId: actor.userId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toPlatformAdminRestaurantResponse(result);
  }

  @Post(':id/reactivate')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurant reactivated successfully.')
  @ApiOperation({
    operationId: 'platformAdminReactivateRestaurant',
    summary: 'Reactivate a suspended Restaurant across any Organization (PlatformAdmin only)',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Restaurant id' })
  @ApiResponse({
    status: 200,
    description: 'Restaurant reactivated',
    type: PlatformAdminRestaurantResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found', ['NOT_FOUND'])
  async reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<PlatformAdminRestaurantResponseDto> {
    const result = await this.reactivateRestaurantUseCase.execute({
      restaurantId: id,
      actorId: actor.userId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toPlatformAdminRestaurantResponse(result);
  }

  @Post(':id/delete')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurant deleted successfully.')
  @ApiOperation({
    operationId: 'platformAdminDeleteRestaurant',
    summary: 'Soft-delete a Restaurant across any Organization (PlatformAdmin only)',
    description:
      'Decrements SubscriptionUsage.restaurantCount in the same transaction (ADR-027 §11), mirroring the existing Owner/Admin-facing delete.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Restaurant id' })
  @ApiResponse({
    status: 200,
    description: 'Restaurant deleted',
    type: PlatformAdminRestaurantResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found', ['NOT_FOUND'])
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<PlatformAdminRestaurantResponseDto> {
    const result = await this.deleteRestaurantUseCase.execute({
      restaurantId: id,
      actorId: actor.userId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toPlatformAdminRestaurantResponse(result);
  }

  @Post(':id/restore')
  @UseGuards(PlatformAdminGuard, PlatformAdminRoleGuard)
  @RequirePlatformAdminRole(PlatformAdminRole.PlatformAdmin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Restaurant restored successfully.')
  @ApiOperation({
    operationId: 'platformAdminRestoreRestaurant',
    summary: 'Restore a soft-deleted Restaurant across any Organization (PlatformAdmin only)',
    description:
      'Closes a standing gap - no actor has ever had a restore capability before ADR-034.',
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Restaurant id' })
  @ApiResponse({
    status: 200,
    description: 'Restaurant restored',
    type: PlatformAdminRestaurantResponseDto,
  })
  @ApiErrorResponse(403, 'Caller is not an active PlatformAdmin', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found', ['NOT_FOUND'])
  @ApiErrorResponse(409, 'Restaurant is not currently deleted', ['CONFLICT'])
  async restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentPlatformAdmin() actor: PlatformAdminActor,
    @Req() request: Request,
  ): Promise<PlatformAdminRestaurantResponseDto> {
    const result = await this.restoreRestaurantUseCase.execute({
      restaurantId: id,
      actorId: actor.userId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toPlatformAdminRestaurantResponse(result);
  }
}
