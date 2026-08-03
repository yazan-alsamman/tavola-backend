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
import { CreateMenuItemOptionGroupUseCase } from '../../application/use-cases/create-menu-item-option-group.use-case';
import { UpdateMenuItemOptionGroupUseCase } from '../../application/use-cases/update-menu-item-option-group.use-case';
import { DeleteMenuItemOptionGroupUseCase } from '../../application/use-cases/delete-menu-item-option-group.use-case';
import { CreateMenuItemOptionUseCase } from '../../application/use-cases/create-menu-item-option.use-case';
import { UpdateMenuItemOptionUseCase } from '../../application/use-cases/update-menu-item-option.use-case';
import { DeleteMenuItemOptionUseCase } from '../../application/use-cases/delete-menu-item-option.use-case';
import { CreateMenuItemOptionGroupRequestDto } from '../dto/create-menu-item-option-group.request.dto';
import { UpdateMenuItemOptionGroupRequestDto } from '../dto/update-menu-item-option-group.request.dto';
import { CreateMenuItemOptionRequestDto } from '../dto/create-menu-item-option.request.dto';
import { UpdateMenuItemOptionRequestDto } from '../dto/update-menu-item-option.request.dto';
import { MenuItemOptionGroupResponseDto } from '../dto/menu-item-option-group.response.dto';
import { MenuItemOptionResponseDto } from '../dto/menu-item-option.response.dto';
import {
  toMenuItemOptionGroupResponse,
  toMenuItemOptionResponse,
} from './menu-item-option-group-response.mapper';

/**
 * Phase 18 (Menu Management, ADR-031/ADR-032). `MenuItemOption` is owned by
 * `MenuItemOptionGroup` (DOMAIN_MODEL.md), so its CRUD routes are nested
 * under this same controller rather than a separate one - tightly coupled
 * resources sharing one file, matching `TableController`'s own precedent of
 * combining Table CRUD with Merge/Split in one controller. See
 * `MenusController`'s own doc comment for the shared dual-actor
 * authorization pattern.
 */
@ApiTags('Menu Item Option Groups')
@ApiExtraModels(ErrorResponseDto)
@Controller({
  path: 'restaurants/:restaurantId/menus/:menuId/categories/:categoryId/items/:itemId/option-groups',
  version: '1',
})
export class MenuItemOptionGroupsController {
  constructor(
    private readonly createGroupUseCase: CreateMenuItemOptionGroupUseCase,
    private readonly updateGroupUseCase: UpdateMenuItemOptionGroupUseCase,
    private readonly deleteGroupUseCase: DeleteMenuItemOptionGroupUseCase,
    private readonly createOptionUseCase: CreateMenuItemOptionUseCase,
    private readonly updateOptionUseCase: UpdateMenuItemOptionUseCase,
    private readonly deleteOptionUseCase: DeleteMenuItemOptionUseCase,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Option group created successfully.')
  @ApiOperation({
    operationId: 'menuOptionGroupsCreate',
    summary: 'Create an Option Group under an Item',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiResponse({
    status: 201,
    description: 'Option group created',
    type: MenuItemOptionGroupResponseDto,
  })
  @ApiErrorResponse(400, 'Validation failure', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, Category, or Item not found', ['NOT_FOUND'])
  async createGroup(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: CreateMenuItemOptionGroupRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuItemOptionGroupResponseDto> {
    const result = await this.createGroupUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      itemId,
      content: body,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMenuItemOptionGroupResponse(result);
  }

  @Patch(':optionGroupId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Option group updated successfully.')
  @ApiOperation({ operationId: 'menuOptionGroupsUpdate', summary: 'Update an Option Group' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiParam({ name: 'optionGroupId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Option group updated',
    type: MenuItemOptionGroupResponseDto,
  })
  @ApiErrorResponse(400, 'Validation failure', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, Category, Item, or Option Group not found', [
    'NOT_FOUND',
  ])
  async updateGroup(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('optionGroupId', ParseUUIDPipe) optionGroupId: string,
    @Body() body: UpdateMenuItemOptionGroupRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuItemOptionGroupResponseDto> {
    const result = await this.updateGroupUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      itemId,
      optionGroupId,
      content: body,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMenuItemOptionGroupResponse(result);
  }

  @Delete(':optionGroupId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({ operationId: 'menuOptionGroupsDelete', summary: 'Soft-delete an Option Group' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiParam({ name: 'optionGroupId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Option group deleted' })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, Category, Item, or Option Group not found', [
    'NOT_FOUND',
  ])
  async deleteGroup(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('optionGroupId', ParseUUIDPipe) optionGroupId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.deleteGroupUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      itemId,
      optionGroupId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  @Post(':optionGroupId/options')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Option created successfully.')
  @ApiOperation({
    operationId: 'menuOptionsCreate',
    summary: 'Create an Option under an Option Group',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiParam({ name: 'optionGroupId', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Option created', type: MenuItemOptionResponseDto })
  @ApiErrorResponse(400, 'Validation failure', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, Category, Item, or Option Group not found', [
    'NOT_FOUND',
  ])
  async createOption(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('optionGroupId', ParseUUIDPipe) optionGroupId: string,
    @Body() body: CreateMenuItemOptionRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuItemOptionResponseDto> {
    const result = await this.createOptionUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      itemId,
      optionGroupId,
      content: body,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMenuItemOptionResponse(result);
  }

  @Patch(':optionGroupId/options/:optionId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Option updated successfully.')
  @ApiOperation({
    operationId: 'menuOptionsUpdate',
    summary: 'Update an Option (name/priceModifier/active)',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiParam({ name: 'optionGroupId', format: 'uuid' })
  @ApiParam({ name: 'optionId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Option updated', type: MenuItemOptionResponseDto })
  @ApiErrorResponse(400, 'Validation failure', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, Category, Item, Option Group, or Option not found', [
    'NOT_FOUND',
  ])
  async updateOption(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('optionGroupId', ParseUUIDPipe) optionGroupId: string,
    @Param('optionId', ParseUUIDPipe) optionId: string,
    @Body() body: UpdateMenuItemOptionRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuItemOptionResponseDto> {
    const result = await this.updateOptionUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      itemId,
      optionGroupId,
      optionId,
      content: { name: body.name, priceModifier: body.priceModifier },
      active: body.active,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMenuItemOptionResponse(result);
  }

  @Delete(':optionGroupId/options/:optionId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({ operationId: 'menuOptionsDelete', summary: 'Soft-delete an Option' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiParam({ name: 'optionGroupId', format: 'uuid' })
  @ApiParam({ name: 'optionId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Option deleted' })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, Category, Item, Option Group, or Option not found', [
    'NOT_FOUND',
  ])
  async deleteOption(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('optionGroupId', ParseUUIDPipe) optionGroupId: string,
    @Param('optionId', ParseUUIDPipe) optionId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.deleteOptionUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      itemId,
      optionGroupId,
      optionId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }
}
