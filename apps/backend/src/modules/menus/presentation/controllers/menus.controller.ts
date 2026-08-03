import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { SkipResponseEnvelope } from '@common/decorators/skip-response-envelope.decorator';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { CreateMenuUseCase } from '../../application/use-cases/create-menu.use-case';
import { UpdateMenuUseCase } from '../../application/use-cases/update-menu.use-case';
import { ActivateMenuUseCase } from '../../application/use-cases/activate-menu.use-case';
import { DeactivateMenuUseCase } from '../../application/use-cases/deactivate-menu.use-case';
import { SetDefaultMenuUseCase } from '../../application/use-cases/set-default-menu.use-case';
import { DeleteMenuUseCase } from '../../application/use-cases/delete-menu.use-case';
import { ListRestaurantMenusUseCase } from '../../application/use-cases/list-restaurant-menus.use-case';
import { GetMenuUseCase } from '../../application/use-cases/get-menu.use-case';
import { CreateMenuRequestDto } from '../dto/create-menu.request.dto';
import { UpdateMenuRequestDto } from '../dto/update-menu.request.dto';
import { MenuResponseDto } from '../dto/menu.response.dto';
import { MenuTreeResponseDto } from '../dto/menu-tree.response.dto';
import { toMenuResponse, toMenuTreeResponse } from './menu-response.mapper';

/**
 * Phase 18 (Menu Management, architecture frozen 2026-08-02, ADR-031;
 * ownership corrected 2026-08-03, ADR-032). Management routes use only
 * `JwtAuthGuard`/`SessionVersionGuard` - authorization (Owner/Admin full
 * access, or Employee holding `menu:manage`) is resolved inside each use
 * case via `assertActorCanManageMenu`, the same dual-actor pattern
 * `AnalyticsController`/`TableController` already established. Public read
 * routes (`list`, `default`, `:menuId`) are unauthenticated.
 */
@ApiTags('Menus')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'restaurants/:restaurantId/menus', version: '1' })
export class MenusController {
  constructor(
    private readonly createMenuUseCase: CreateMenuUseCase,
    private readonly updateMenuUseCase: UpdateMenuUseCase,
    private readonly activateMenuUseCase: ActivateMenuUseCase,
    private readonly deactivateMenuUseCase: DeactivateMenuUseCase,
    private readonly setDefaultMenuUseCase: SetDefaultMenuUseCase,
    private readonly deleteMenuUseCase: DeleteMenuUseCase,
    private readonly listRestaurantMenusUseCase: ListRestaurantMenusUseCase,
    private readonly getMenuUseCase: GetMenuUseCase,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Menu created successfully.')
  @ApiOperation({
    operationId: 'menusCreate',
    summary: 'Create a Menu under a Restaurant',
    description:
      'A Restaurant may own multiple Menus (ADR-032) - the first Menu created is auto-marked isDefault.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Menu created', type: MenuResponseDto })
  @ApiErrorResponse(400, 'Validation failure', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found (or belongs to another organization)', ['NOT_FOUND'])
  async create(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Body() body: CreateMenuRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuResponseDto> {
    const result = await this.createMenuUseCase.execute({
      actor,
      restaurantId,
      name: body.name,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMenuResponse(result);
  }

  @Get()
  @ApiOperation({
    operationId: 'menusListPublic',
    summary: "List a Restaurant's active Menus (Customer, public)",
    description:
      'Unpaginated - corrected by ADR-032 from a single-resource read to a collection read.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Menus retrieved', type: [MenuResponseDto] })
  @ApiErrorResponse(404, 'Restaurant not found', ['NOT_FOUND'])
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Menus retrieved successfully.')
  async listPublic(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
  ): Promise<MenuResponseDto[]> {
    const results = await this.listRestaurantMenusUseCase.execute({ restaurantId });
    return results.map(toMenuResponse);
  }

  @Get('default')
  @ApiOperation({
    operationId: 'menusGetDefault',
    summary: "Get the Restaurant's default Menu (Customer, public, full nested tree)",
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Menu retrieved', type: MenuTreeResponseDto })
  @ApiErrorResponse(404, 'Restaurant not found, or no active default Menu exists', ['NOT_FOUND'])
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Menu retrieved successfully.')
  async getDefault(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
  ): Promise<MenuTreeResponseDto> {
    const result = await this.getMenuUseCase.execute({ restaurantId });
    return toMenuTreeResponse(result);
  }

  @Get(':menuId')
  @ApiOperation({
    operationId: 'menusGet',
    summary: 'Get a specific Menu (Customer, public, full nested tree)',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Menu retrieved', type: MenuTreeResponseDto })
  @ApiErrorResponse(404, 'Restaurant not found, or Menu not found (or inactive)', ['NOT_FOUND'])
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Menu retrieved successfully.')
  async get(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
  ): Promise<MenuTreeResponseDto> {
    const result = await this.getMenuUseCase.execute({ restaurantId, menuId });
    return toMenuTreeResponse(result);
  }

  @Patch(':menuId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Menu updated successfully.')
  @ApiOperation({
    operationId: 'menusUpdate',
    summary: 'Update a Menu (name, displayOrder)',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Menu updated', type: MenuResponseDto })
  @ApiErrorResponse(400, 'Validation failure', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found, or Menu not found', ['NOT_FOUND'])
  async update(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Body() body: UpdateMenuRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuResponseDto> {
    const result = await this.updateMenuUseCase.execute({
      actor,
      restaurantId,
      menuId,
      name: body.name,
      displayOrder: body.displayOrder,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMenuResponse(result);
  }

  @Post(':menuId/activate')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Menu activated successfully.')
  @ApiOperation({ operationId: 'menusActivate', summary: 'Activate a Menu' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Menu activated', type: MenuResponseDto })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found, or Menu not found', ['NOT_FOUND'])
  async activate(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuResponseDto> {
    const result = await this.activateMenuUseCase.execute({
      actor,
      restaurantId,
      menuId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMenuResponse(result);
  }

  @Post(':menuId/deactivate')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Menu deactivated successfully.')
  @ApiOperation({ operationId: 'menusDeactivate', summary: 'Deactivate a Menu' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Menu deactivated', type: MenuResponseDto })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found, or Menu not found', ['NOT_FOUND'])
  async deactivate(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuResponseDto> {
    const result = await this.deactivateMenuUseCase.execute({
      actor,
      restaurantId,
      menuId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMenuResponse(result);
  }

  @Post(':menuId/set-default')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Menu set as default successfully.')
  @ApiOperation({
    operationId: 'menusSetDefault',
    summary: "Set this Menu as the Restaurant's default (ADR-032)",
    description:
      'Atomically unmarks whichever Menu previously held isDefault in the same transaction.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Menu set as default', type: MenuResponseDto })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found, or Menu not found', ['NOT_FOUND'])
  async setDefault(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuResponseDto> {
    const result = await this.setDefaultMenuUseCase.execute({
      actor,
      restaurantId,
      menuId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMenuResponse(result);
  }

  @Delete(':menuId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({ operationId: 'menusDelete', summary: 'Soft-delete a Menu' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Menu deleted' })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found, or Menu not found', ['NOT_FOUND'])
  async delete(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.deleteMenuUseCase.execute({
      actor,
      restaurantId,
      menuId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }
}
