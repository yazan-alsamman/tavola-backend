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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
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
import { CreateMenuItemUseCase } from '../../application/use-cases/create-menu-item.use-case';
import { UpdateMenuItemUseCase } from '../../application/use-cases/update-menu-item.use-case';
import { DeleteMenuItemUseCase } from '../../application/use-cases/delete-menu-item.use-case';
import { ReorderMenuItemsUseCase } from '../../application/use-cases/reorder-menu-items.use-case';
import { FeatureMenuItemUseCase } from '../../application/use-cases/feature-menu-item.use-case';
import { UnfeatureMenuItemUseCase } from '../../application/use-cases/unfeature-menu-item.use-case';
import { ReplaceMenuItemAvailabilityWindowsUseCase } from '../../application/use-cases/replace-menu-item-availability-windows.use-case';
import { UploadMenuItemImageUseCase } from '../../application/use-cases/upload-menu-item-image.use-case';
import { RemoveMenuItemImageUseCase } from '../../application/use-cases/remove-menu-item-image.use-case';
import { GetMenuItemUseCase } from '../../application/use-cases/get-menu-item.use-case';
import { MENU_IMAGE_MAX_SIZE_BYTES } from '../../application/policies/menu-image-upload.policy';
import { CreateMenuItemRequestDto } from '../dto/create-menu-item.request.dto';
import { UpdateMenuItemRequestDto } from '../dto/update-menu-item.request.dto';
import { ReorderRequestDto } from '../dto/reorder.request.dto';
import { ReplaceAvailabilityWindowsRequestDto } from '../dto/replace-availability-windows.request.dto';
import { MenuItemResponseDto } from '../dto/menu-item.response.dto';
import { MenuItemTreeResponseDto } from '../dto/menu-tree.response.dto';
import { MenuImageResponseDto } from '../dto/menu-image.response.dto';
import { toMenuItemResponse, toMenuItemPublicResponse } from './menu-item-response.mapper';

/** Phase 18 (Menu Management, ADR-031/ADR-032). See `MenusController`'s own doc comment for the dual-actor authorization pattern shared by every management route below. */
@ApiTags('Menu Items')
@ApiExtraModels(ErrorResponseDto)
@Controller({
  path: 'restaurants/:restaurantId/menus/:menuId/categories/:categoryId/items',
  version: '1',
})
export class MenuItemsController {
  constructor(
    private readonly createUseCase: CreateMenuItemUseCase,
    private readonly updateUseCase: UpdateMenuItemUseCase,
    private readonly deleteUseCase: DeleteMenuItemUseCase,
    private readonly reorderUseCase: ReorderMenuItemsUseCase,
    private readonly featureUseCase: FeatureMenuItemUseCase,
    private readonly unfeatureUseCase: UnfeatureMenuItemUseCase,
    private readonly replaceAvailabilityUseCase: ReplaceMenuItemAvailabilityWindowsUseCase,
    private readonly uploadImageUseCase: UploadMenuItemImageUseCase,
    private readonly removeImageUseCase: RemoveMenuItemImageUseCase,
    private readonly getUseCase: GetMenuItemUseCase,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Item created successfully.')
  @ApiOperation({ operationId: 'menuItemsCreate', summary: 'Create an Item under a Category' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Item created', type: MenuItemResponseDto })
  @ApiErrorResponse(400, 'Validation failure', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, or Category not found', ['NOT_FOUND'])
  async create(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: CreateMenuItemRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuItemResponseDto> {
    const result = await this.createUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      content: {
        name: body.name,
        description: body.description ?? null,
        price: body.price,
        currency: body.currency ?? null,
        preparationTimeMinutes: body.preparationTimeMinutes ?? null,
        spicyLevel: body.spicyLevel ?? null,
        calories: body.calories ?? null,
        allergens: body.allergens ?? [],
        dietaryLabels: body.dietaryLabels ?? [],
      },
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMenuItemResponse(result);
  }

  @Patch('reorder')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Items reordered successfully.')
  @ApiOperation({
    operationId: 'menuItemsReorder',
    summary: 'Reorder Items within a Category (whole-set replacement)',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Items reordered', type: [MenuItemResponseDto] })
  @ApiErrorResponse(400, 'orderedIds does not exactly match the current non-deleted sibling set', [
    'VALIDATION_ERROR',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, or Category not found', ['NOT_FOUND'])
  async reorder(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: ReorderRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuItemResponseDto[]> {
    const results = await this.reorderUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      orderedMenuItemIds: body.orderedIds,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return results.map(toMenuItemResponse);
  }

  @Get(':itemId')
  @ApiOperation({ operationId: 'menuItemsGet', summary: 'Get Item Details (Customer, public)' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Item retrieved', type: MenuItemTreeResponseDto })
  @ApiErrorResponse(404, 'Restaurant or Item not found', ['NOT_FOUND'])
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Item retrieved successfully.')
  async get(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<MenuItemTreeResponseDto> {
    const result = await this.getUseCase.execute({ restaurantId, itemId });
    return toMenuItemPublicResponse(result);
  }

  @Patch(':itemId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Item updated successfully.')
  @ApiOperation({
    operationId: 'menuItemsUpdate',
    summary: 'Update an Item (includes availabilityMode - no separate endpoint)',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Item updated', type: MenuItemResponseDto })
  @ApiErrorResponse(400, 'Validation failure', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, Category, or Item not found', ['NOT_FOUND'])
  async update(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: UpdateMenuItemRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuItemResponseDto> {
    const result = await this.updateUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      itemId,
      content: {
        name: body.name,
        description: body.description ?? null,
        price: body.price,
        currency: body.currency ?? null,
        preparationTimeMinutes: body.preparationTimeMinutes ?? null,
        spicyLevel: body.spicyLevel ?? null,
        calories: body.calories ?? null,
        allergens: body.allergens ?? [],
        dietaryLabels: body.dietaryLabels ?? [],
      },
      availabilityMode: body.availabilityMode,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMenuItemResponse(result);
  }

  @Delete(':itemId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({ operationId: 'menuItemsDelete', summary: 'Soft-delete an Item' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Item deleted' })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, Category, or Item not found', ['NOT_FOUND'])
  async delete(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.deleteUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      itemId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  @Post(':itemId/feature')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Item featured successfully.')
  @ApiOperation({ operationId: 'menuItemsFeature', summary: 'Mark an Item as featured (ADR-032)' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Item featured', type: MenuItemResponseDto })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, Category, or Item not found', ['NOT_FOUND'])
  async feature(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuItemResponseDto> {
    const result = await this.featureUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      itemId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMenuItemResponse(result);
  }

  @Post(':itemId/unfeature')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Item unfeatured successfully.')
  @ApiOperation({
    operationId: 'menuItemsUnfeature',
    summary: 'Remove an Item from featured (ADR-032)',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Item unfeatured', type: MenuItemResponseDto })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, Category, or Item not found', ['NOT_FOUND'])
  async unfeature(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuItemResponseDto> {
    const result = await this.unfeatureUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      itemId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMenuItemResponse(result);
  }

  @Patch(':itemId/availability')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({
    operationId: 'menuItemsReplaceAvailability',
    summary: "Replace an Item's availability windows (whole-set replacement, ADR-032)",
    description:
      'Valid only while availabilityMode = Scheduled. An empty windows array clears all windows.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Availability windows replaced' })
  @ApiErrorResponse(400, 'Invalid window shape, or availabilityMode is not Scheduled', [
    'VALIDATION_ERROR',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, Category, or Item not found', ['NOT_FOUND'])
  async replaceAvailability(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() body: ReplaceAvailabilityWindowsRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.replaceAvailabilityUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      itemId,
      windows: body.windows,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  @Post(':itemId/image')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MENU_IMAGE_MAX_SIZE_BYTES, files: 1 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ResponseMessage('Item image uploaded successfully.')
  @ApiOperation({
    operationId: 'menuItemsUploadImage',
    summary: 'Upload/replace an Item image',
    description:
      'Single multipart image file (JPEG/PNG/WebP, 5MB max, validated by magic-byte signature). Reuses the existing Files/MinIO pipeline (FileOwnerType.Menu). Replaces any prior image wholesale.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Image uploaded', type: MenuImageResponseDto })
  @ApiErrorResponse(400, 'Missing file or the file is not a valid supported image', [
    'VALIDATION_ERROR',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, Category, or Item not found', ['NOT_FOUND'])
  @ApiErrorResponse(503, 'Image storage is temporarily unavailable', ['STORAGE_UNAVAILABLE'])
  async uploadImage(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuImageResponseDto> {
    return this.uploadImageUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      itemId,
      file: file ? { buffer: file.buffer, mimeType: file.mimetype, sizeBytes: file.size } : null,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  @Delete(':itemId/image')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({ operationId: 'menuItemsRemoveImage', summary: 'Remove an Item image' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Image removed' })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, Category, or Item not found', ['NOT_FOUND'])
  async removeImage(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.removeImageUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      itemId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }
}
