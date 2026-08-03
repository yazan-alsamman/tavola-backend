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
import { CreateMenuCategoryUseCase } from '../../application/use-cases/create-menu-category.use-case';
import { UpdateMenuCategoryUseCase } from '../../application/use-cases/update-menu-category.use-case';
import { DeleteMenuCategoryUseCase } from '../../application/use-cases/delete-menu-category.use-case';
import { ReorderMenuCategoriesUseCase } from '../../application/use-cases/reorder-menu-categories.use-case';
import { UploadMenuCategoryImageUseCase } from '../../application/use-cases/upload-menu-category-image.use-case';
import { RemoveMenuCategoryImageUseCase } from '../../application/use-cases/remove-menu-category-image.use-case';
import { GetMenuCategoryUseCase } from '../../application/use-cases/get-menu-category.use-case';
import { MENU_IMAGE_MAX_SIZE_BYTES } from '../../application/policies/menu-image-upload.policy';
import { CreateMenuCategoryRequestDto } from '../dto/create-menu-category.request.dto';
import { UpdateMenuCategoryRequestDto } from '../dto/update-menu-category.request.dto';
import { ReorderRequestDto } from '../dto/reorder.request.dto';
import { MenuCategoryResponseDto } from '../dto/menu-category.response.dto';
import { MenuCategoryPublicResponseDto } from '../dto/menu-category-public.response.dto';
import { MenuImageResponseDto } from '../dto/menu-image.response.dto';
import {
  toMenuCategoryResponse,
  toMenuCategoryPublicResponse,
} from './menu-category-response.mapper';

const API_GUIDELINES_REORDER_NOTE =
  'orderedIds must exactly match the current non-deleted Category set under this Menu (set equality, both directions) - a partial array, a foreign id, or an id belonging to a different Menu is rejected before any displayOrder value is written.';

/** Phase 18 (Menu Management, ADR-031/ADR-032). See `MenusController`'s own doc comment for the dual-actor authorization pattern shared by every management route below. */
@ApiTags('Menu Categories')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'restaurants/:restaurantId/menus/:menuId/categories', version: '1' })
export class MenuCategoriesController {
  constructor(
    private readonly createUseCase: CreateMenuCategoryUseCase,
    private readonly updateUseCase: UpdateMenuCategoryUseCase,
    private readonly deleteUseCase: DeleteMenuCategoryUseCase,
    private readonly reorderUseCase: ReorderMenuCategoriesUseCase,
    private readonly uploadImageUseCase: UploadMenuCategoryImageUseCase,
    private readonly removeImageUseCase: RemoveMenuCategoryImageUseCase,
    private readonly getUseCase: GetMenuCategoryUseCase,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Category created successfully.')
  @ApiOperation({ operationId: 'menuCategoriesCreate', summary: 'Create a Category under a Menu' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Category created', type: MenuCategoryResponseDto })
  @ApiErrorResponse(400, 'Validation failure', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant or Menu not found', ['NOT_FOUND'])
  async create(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Body() body: CreateMenuCategoryRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuCategoryResponseDto> {
    const result = await this.createUseCase.execute({
      actor,
      restaurantId,
      menuId,
      name: body.name,
      description: body.description ?? null,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMenuCategoryResponse(result);
  }

  @Patch('reorder')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Categories reordered successfully.')
  @ApiOperation({
    operationId: 'menuCategoriesReorder',
    summary: 'Reorder Categories within a Menu (whole-set replacement)',
    description: API_GUIDELINES_REORDER_NOTE,
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Categories reordered',
    type: [MenuCategoryResponseDto],
  })
  @ApiErrorResponse(400, 'orderedIds does not exactly match the current non-deleted sibling set', [
    'VALIDATION_ERROR',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant or Menu not found', ['NOT_FOUND'])
  async reorder(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Body() body: ReorderRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuCategoryResponseDto[]> {
    const results = await this.reorderUseCase.execute({
      actor,
      restaurantId,
      menuId,
      orderedCategoryIds: body.orderedIds,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return results.map(toMenuCategoryResponse);
  }

  @Get(':categoryId')
  @ApiOperation({ operationId: 'menuCategoriesGet', summary: 'Get a Category (Customer, public)' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Category retrieved',
    type: MenuCategoryPublicResponseDto,
  })
  @ApiErrorResponse(404, 'Restaurant or Category not found', ['NOT_FOUND'])
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Category retrieved successfully.')
  async get(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
  ): Promise<MenuCategoryPublicResponseDto> {
    const result = await this.getUseCase.execute({ restaurantId, categoryId });
    return toMenuCategoryPublicResponse(result);
  }

  @Patch(':categoryId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Category updated successfully.')
  @ApiOperation({ operationId: 'menuCategoriesUpdate', summary: 'Update a Category' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Category updated', type: MenuCategoryResponseDto })
  @ApiErrorResponse(400, 'Validation failure', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, or Category not found', ['NOT_FOUND'])
  async update(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() body: UpdateMenuCategoryRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuCategoryResponseDto> {
    const result = await this.updateUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      name: body.name,
      description: body.description ?? null,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toMenuCategoryResponse(result);
  }

  @Delete(':categoryId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({ operationId: 'menuCategoriesDelete', summary: 'Soft-delete a Category' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Category deleted' })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, or Category not found', ['NOT_FOUND'])
  async delete(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.deleteUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  @Post(':categoryId/image')
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
  @ResponseMessage('Category image uploaded successfully.')
  @ApiOperation({
    operationId: 'menuCategoriesUploadImage',
    summary: 'Upload/replace a Category image',
    description:
      'Single multipart image file (JPEG/PNG/WebP, 5MB max, validated by magic-byte signature). Reuses the existing Files/MinIO pipeline (FileOwnerType.Menu). Replaces any prior image wholesale.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Image uploaded', type: MenuImageResponseDto })
  @ApiErrorResponse(400, 'Missing file or the file is not a valid supported image', [
    'VALIDATION_ERROR',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, or Category not found', ['NOT_FOUND'])
  @ApiErrorResponse(503, 'Image storage is temporarily unavailable', ['STORAGE_UNAVAILABLE'])
  async uploadImage(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MenuImageResponseDto> {
    return this.uploadImageUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      file: file ? { buffer: file.buffer, mimeType: file.mimetype, sizeBytes: file.size } : null,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }

  @Delete(':categoryId/image')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({ operationId: 'menuCategoriesRemoveImage', summary: 'Remove a Category image' })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'menuId', format: 'uuid' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Image removed' })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not Owner/Admin and lacks menu:manage', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant, Menu, or Category not found', ['NOT_FOUND'])
  async removeImage(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('menuId', ParseUUIDPipe) menuId: string,
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.removeImageUseCase.execute({
      actor,
      restaurantId,
      menuId,
      categoryId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }
}
