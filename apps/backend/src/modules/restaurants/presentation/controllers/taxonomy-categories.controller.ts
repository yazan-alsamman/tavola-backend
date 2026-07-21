import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ResponseMessage } from '@common/decorators/response-message.decorator';
import { ListCuisineCategoriesUseCase } from '../../application/use-cases/list-cuisine-categories.use-case';
import { ListOccasionCategoriesUseCase } from '../../application/use-cases/list-occasion-categories.use-case';
import { CuisineCategoryResult } from '../../application/dto/cuisine-category.result';
import { OccasionCategoryResult } from '../../application/dto/occasion-category.result';
import {
  CuisineCategoryListResponseDto,
  CuisineCategoryResponseDto,
} from '../dto/cuisine-category.response.dto';
import {
  OccasionCategoryListResponseDto,
  OccasionCategoryResponseDto,
} from '../dto/occasion-category.response.dto';

/**
 * Public reference-data endpoints (Phase 4.5, ADR-018) - `CuisineCategory`/
 * `OccasionCategory` are platform-managed, not tenant-owned, so these routes
 * carry no auth guard, unlike every other route in this module. Lets a
 * client render a taxonomy picker before/without authenticating.
 */
@ApiTags('Taxonomy')
@Controller({ version: '1' })
export class TaxonomyCategoriesController {
  constructor(
    private readonly listCuisineCategoriesUseCase: ListCuisineCategoriesUseCase,
    private readonly listOccasionCategoriesUseCase: ListOccasionCategoriesUseCase,
  ) {}

  @Get('cuisine-categories')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Cuisine categories retrieved successfully.')
  @ApiOperation({
    operationId: 'cuisineCategoriesList',
    summary: 'List active cuisine categories',
    description:
      'Platform-managed reference data (ADR-018), seeded at deploy - not tenant-scoped. Sorted by sortOrder. Public, no authentication required.',
  })
  @ApiResponse({
    status: 200,
    description: 'Cuisine categories retrieved',
    type: CuisineCategoryListResponseDto,
  })
  async listCuisineCategories(): Promise<CuisineCategoryListResponseDto> {
    const results = await this.listCuisineCategoriesUseCase.execute();
    return { items: results.map((result) => this.toCuisineCategoryResponse(result)) };
  }

  @Get('occasion-categories')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Occasion categories retrieved successfully.')
  @ApiOperation({
    operationId: 'occasionCategoriesList',
    summary: 'List active occasion categories',
    description:
      'Platform-managed reference data (ADR-018), seeded at deploy - not tenant-scoped. Sorted by sortOrder. Public, no authentication required.',
  })
  @ApiResponse({
    status: 200,
    description: 'Occasion categories retrieved',
    type: OccasionCategoryListResponseDto,
  })
  async listOccasionCategories(): Promise<OccasionCategoryListResponseDto> {
    const results = await this.listOccasionCategoriesUseCase.execute();
    return { items: results.map((result) => this.toOccasionCategoryResponse(result)) };
  }

  private toCuisineCategoryResponse(result: CuisineCategoryResult): CuisineCategoryResponseDto {
    return {
      cuisineCategoryId: result.cuisineCategoryId,
      slug: result.slug,
      name: result.name,
      sortOrder: result.sortOrder,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    };
  }

  private toOccasionCategoryResponse(result: OccasionCategoryResult): OccasionCategoryResponseDto {
    return {
      occasionCategoryId: result.occasionCategoryId,
      slug: result.slug,
      name: result.name,
      sortOrder: result.sortOrder,
      createdAt: result.createdAt.toISOString(),
      updatedAt: result.updatedAt.toISOString(),
    };
  }
}
