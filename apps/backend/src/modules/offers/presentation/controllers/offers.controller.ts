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
import { SkipResponseEnvelope } from '@common/decorators/skip-response-envelope.decorator';
import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { OrganizationMemberGuard } from '@modules/authorization/presentation/guards/organization-member.guard';
import { RequireOrgRole } from '@modules/authorization/presentation/decorators/require-org-role.decorator';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { CreateOfferUseCase } from '../../application/use-cases/create-offer.use-case';
import { UpdateOfferUseCase } from '../../application/use-cases/update-offer.use-case';
import { PublishOfferUseCase } from '../../application/use-cases/publish-offer.use-case';
import { DeleteOfferUseCase } from '../../application/use-cases/delete-offer.use-case';
import { ListRestaurantOffersUseCase } from '../../application/use-cases/list-restaurant-offers.use-case';
import { CreateOfferRequestDto } from '../dto/create-offer.request.dto';
import { UpdateOfferRequestDto } from '../dto/update-offer.request.dto';
import { ListOffersQueryDto } from '../dto/list-offers.query.dto';
import { OfferResponseDto } from '../dto/offer.response.dto';
import { OfferListResponseDto } from '../dto/offer-list.response.dto';
import { toOfferListResponse, toOfferResponse } from './offer-response.mapper';

/**
 * Phase 11 (Offers, architecture frozen 2026-07-28, owner-approved,
 * implemented 2026-07-28). Organization-administrative only (owner decision
 * D4): every route requires `OrganizationMemberGuard` +
 * `@RequireOrgRole(Owner, Admin)`, identical to `RestaurantsController`'s
 * Gallery/Settings/Working-Hours precedent - never combined with Employee
 * RBAC on the same route, and no `offers:*` permission slug exists. The
 * Customer-facing public read surface lives on a deliberately separate path
 * (`GET /discovery/restaurants/:restaurantId/offers`, `DiscoveryModule`) to
 * avoid a same-path GET collision with this controller's own management
 * listing - see `ListPublicOffersUseCase`'s doc comment.
 */
@ApiTags('Offers')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'restaurants/:restaurantId/offers', version: '1' })
export class OffersController {
  constructor(
    private readonly createOfferUseCase: CreateOfferUseCase,
    private readonly updateOfferUseCase: UpdateOfferUseCase,
    private readonly publishOfferUseCase: PublishOfferUseCase,
    private readonly deleteOfferUseCase: DeleteOfferUseCase,
    private readonly listRestaurantOffersUseCase: ListRestaurantOffersUseCase,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Offer created successfully.')
  @ApiOperation({
    operationId: 'offersCreate',
    summary: 'Create an offer under a restaurant',
    description:
      'Always created as Draft - no request field controls status. type (Promotion/Coupon/Event) is display/filtering metadata only; discountType/discountValue apply uniformly regardless of type (Coupons are display-only in v1, no redemption engine).',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Offer created', type: OfferResponseDto })
  @ApiErrorResponse(400, 'Validation failure (invalid field format, or startsAt >= endsAt)', [
    'VALIDATION_ERROR',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found (or belongs to another organization)', ['NOT_FOUND'])
  async create(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Body() body: CreateOfferRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<OfferResponseDto> {
    const result = await this.createOfferUseCase.execute({
      actor,
      restaurantId,
      type: body.type,
      title: body.title,
      description: body.description,
      discountType: body.discountType,
      discountValue: body.discountValue,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toOfferResponse(result);
  }

  @Get()
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Offers retrieved successfully.')
  @ApiOperation({
    operationId: 'offersListManagement',
    summary: 'List offers of a restaurant (management, every status)',
    description:
      'Paginated, ordered most-recently-created first. Every status (Draft/Published/Expired) - the Customer-facing public listing (Published, currently active, not soft-deleted only) is a separate endpoint: GET /discovery/restaurants/:restaurantId/offers.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Offers retrieved', type: OfferListResponseDto })
  @ApiErrorResponse(400, 'Invalid page/limit or restaurantId', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(404, 'Restaurant not found (or belongs to another organization)', ['NOT_FOUND'])
  async list(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Query() query: ListOffersQueryDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
  ): Promise<OfferListResponseDto> {
    const result = await this.listRestaurantOffersUseCase.execute({
      actor,
      restaurantId,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
    return toOfferListResponse(result);
  }

  @Patch(':offerId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Offer updated successfully.')
  @ApiOperation({
    operationId: 'offersUpdate',
    summary: 'Update an offer (full-replace, Draft only)',
    description:
      'Full-replace update of type/title/description/discountType/discountValue/startsAt/endsAt. Reachable only while status = Draft - Published/Expired offers are immutable (400 if the offer is no longer Draft, including a race against a concurrent Publish).',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'offerId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Offer updated', type: OfferResponseDto })
  @ApiErrorResponse(
    400,
    'Validation failure, startsAt >= endsAt, or the offer is no longer Draft',
    ['VALIDATION_ERROR'],
  )
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(
    404,
    'Restaurant not found, or offer not found (or belongs to another restaurant)',
    ['NOT_FOUND'],
  )
  async update(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @Body() body: UpdateOfferRequestDto,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<OfferResponseDto> {
    const result = await this.updateOfferUseCase.execute({
      actor,
      restaurantId,
      offerId,
      type: body.type,
      title: body.title,
      description: body.description,
      discountType: body.discountType,
      discountValue: body.discountValue,
      startsAt: new Date(body.startsAt),
      endsAt: new Date(body.endsAt),
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toOfferResponse(result);
  }

  @Post(':offerId/publish')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Offer published successfully.')
  @ApiOperation({
    operationId: 'offersPublish',
    summary: 'Publish an offer (Domain Action, Draft only)',
    description:
      'Draft -> Published only. Schedules a BullMQ job (OfferExpirationQueue) to automatically transition the offer to Expired at endsAt, CAS-guarded against replay. Rejected (400) if the offer is no longer Draft, or if endsAt has already passed.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'offerId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Offer published', type: OfferResponseDto })
  @ApiErrorResponse(400, 'Offer is not currently Draft, or endsAt has already passed', [
    'VALIDATION_ERROR',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(
    404,
    'Restaurant not found, or offer not found (or belongs to another restaurant)',
    ['NOT_FOUND'],
  )
  async publish(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<OfferResponseDto> {
    const result = await this.publishOfferUseCase.execute({
      actor,
      restaurantId,
      offerId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
    return toOfferResponse(result);
  }

  @Delete(':offerId')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, OrganizationMemberGuard)
  @RequireOrgRole(OrganizationMemberRole.Owner, OrganizationMemberRole.Admin)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @SkipResponseEnvelope()
  @ApiOperation({
    operationId: 'offersDelete',
    summary: 'Soft-delete an offer',
    description:
      'Soft delete (ADR-010) - sets deletedAt, never removes the row. Reachable from any state (Draft/Published/Expired). Not idempotent: deleting an already-deleted offer returns 404. Cancels the BullMQ expiration job if the offer was Published.',
  })
  @ApiParam({ name: 'restaurantId', format: 'uuid' })
  @ApiParam({ name: 'offerId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Offer deleted' })
  @ApiErrorResponse(400, 'restaurantId or offerId is not a valid UUID', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Caller is not an Owner/Admin organization member', ['FORBIDDEN'])
  @ApiErrorResponse(
    404,
    'Restaurant not found, or offer not found (or belongs to another restaurant)',
    ['NOT_FOUND'],
  )
  async delete(
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @CurrentActor() actor: AuthenticatedOrganizationMemberActor,
    @Req() request: Request,
  ): Promise<void> {
    await this.deleteOfferUseCase.execute({
      actor,
      restaurantId,
      offerId,
      correlationId: request.headers['x-correlation-id'] as string | undefined,
    });
  }
}
