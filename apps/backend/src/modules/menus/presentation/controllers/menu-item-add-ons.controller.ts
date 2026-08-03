import {
  Body,
  Controller,
  Delete,
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
import { CreateMenuItemAddOnUseCase } from '../../application/use-cases/create-menu-item-add-on.use-case';
import { UpdateMenuItemAddOnUseCase } from '../../application/use-cases/update-menu-item-add-on.use-case';
import { DeleteMenuItemAddOnUseCase } from '../../application/use-cases/delete-menu-item-add-on.use-case';
import { CreateMenuItemAddOnRequestDto } from '../dto/create-menu-item-add-on.request.dto';
import { UpdateMenuItemAddOnRequestDto } from '../dto/update-menu-item-add-on.request.dto';
import { MenuItemAddOnResponseDto } from '../dto/menu-item-add-on.response.dto';
import { toMenuItemAddOnResponse } from './menu-item-add-on-response.mapper';

/** Phase 18 (Menu Management, ADR-031/ADR-032). See `MenusController`'s own doc comment for the shared dual-actor authorization pattern. */
@ApiTags('Menu Item Add-ons')
@ApiExtraModels(ErrorResponseDto)
@Controller({
  path: 'restaurants/:restaurantId/menus/:menuId/categories/:categoryId/items/:itemId/add-ons',
  version: '1',
})
export class MenuItemAddOnsController {
  constructor(
    private readonly createUseCase: CreateMenuItemAddOnUseCase,
    private readonly updateUseCase: UpdateMenuItemAddOnUseCase,
    private readonly deleteUseCase: DeleteMenuItemAddOnUseCase,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Add-on created successfully.')
  @ApiOperation({ operationId: 'menuAddOnsCreate', summary: 'Create an Add-on under an Item' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Add-on created', type: MenuItemAddOnResponseDto })
  @ApiErrorResponse(400, 'Validation failure', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, Category, or Item not found', ['NOT_FOUND'])
  async create(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: CreateMenuItemAddOnRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuItemAddOnResponseDto> {
    const result = await this.createUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      itemId,
      content: body,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMenuItemAddOnResponse(result);
  }

  @Patch(':addOnId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Add-on updated successfully.')
  @ApiOperation({
    operationId: 'menuAddOnsUpdate',
    summary: 'Update an Add-on (name/price/active)',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiParam({ name: 'addOnId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Add-on updated', type: MenuItemAddOnResponseDto })
  @ApiErrorResponse(400, 'Validation failure', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, Category, Item, or Add-on not found', ['NOT_FOUND'])
  async update(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('addOnId', ParseUUIDPipe) addOnId: string,
    @Body() body: UpdateMenuItemAddOnRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuItemAddOnResponseDto> {
    const result = await this.updateUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      itemId,
      addOnId,
      content: { name: body.name, price: body.price },
      active: body.active,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMenuItemAddOnResponse(result);
  }

  @Delete(':addOnId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({ operationId: 'menuAddOnsDelete', summary: 'Soft-delete an Add-on' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiParam({ name: 'addOnId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Add-on deleted' })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, Category, Item, or Add-on not found', ['NOT_FOUND'])
  async delete(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('addOnId', ParseUUIDPipe) addOnId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.deleteUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      itemId,
      addOnId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }
}
