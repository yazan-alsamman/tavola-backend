import {
  Body,
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
  UseInterceptors,
  UploadedFile,
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
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { MESSAGE_ATTACHMENT_MAX_SIZE_BYTES } from '../../application/policies/message-attachment-upload.policy';
import { StartConversationUseCase } from '../../application/use-cases/start-conversation.use-case';
import { GetConversationUseCase } from '../../application/use-cases/get-conversation.use-case';
import { SendMessageUseCase } from '../../application/use-cases/send-message.use-case';
import { ListMessagesUseCase } from '../../application/use-cases/list-messages.use-case';
import { ListCustomerConversationsUseCase } from '../../application/use-cases/list-customer-conversations.use-case';
import { MarkConversationReadUseCase } from '../../application/use-cases/mark-conversation-read.use-case';
import { CloseConversationUseCase } from '../../application/use-cases/close-conversation.use-case';
import { StartConversationRequestDto } from '../dto/start-conversation.request.dto';
import { SendMessageRequestDto } from '../dto/send-message.request.dto';
import { CursorPaginationQueryDto } from '../dto/cursor-pagination.query.dto';
import { ListCustomerConversationsQueryDto } from '../dto/list-customer-conversations.query.dto';
import { ConversationResponseDto } from '../dto/conversation.response.dto';
import { ConversationListResponseDto } from '../dto/conversation-list.response.dto';
import { MessageResponseDto } from '../dto/message.response.dto';
import { MessageListResponseDto } from '../dto/message-list.response.dto';
import { MarkConversationReadResponseDto } from '../dto/mark-conversation-read.response.dto';
import { MessagingSendRateLimitGuard } from '../guards/messaging-send-rate-limit.guard';
import { MessagingIdempotencyInterceptor } from '../interceptors/messaging-idempotency.interceptor';
import {
  toConversationResponse,
  toConversationListResponse,
  toMessageResponse,
  toMessageListResponse,
  toMarkConversationReadResponse,
} from '../mappers/messaging-response.mapper';

function correlationId(request: Request): string | undefined {
  return request.headers['x-correlation-id'] as string | undefined;
}

/**
 * Phase 15.6 (Messaging, ADR-020 corrected by ADR-030). Every route carries
 * only `JwtAuthGuard`/`SessionVersionGuard` - authorization (Customer
 * ownership vs. Restaurant-side Dual Actor, D15) is resolved inside each use
 * case via `ConversationAccessService`, exactly like Tables Merge/Split
 * (ADR-026) and Analytics (ADR-028). See `RestaurantConversationsController`
 * for the Staff-only `GET /restaurants/:restaurantId/conversations` list.
 */
@ApiTags('Messaging')
@ApiExtraModels(ErrorResponseDto)
@Controller({ path: 'conversations', version: '1' })
export class ConversationsController {
  constructor(
    private readonly startConversationUseCase: StartConversationUseCase,
    private readonly getConversationUseCase: GetConversationUseCase,
    private readonly sendMessageUseCase: SendMessageUseCase,
    private readonly listMessagesUseCase: ListMessagesUseCase,
    private readonly listCustomerConversationsUseCase: ListCustomerConversationsUseCase,
    private readonly markConversationReadUseCase: MarkConversationReadUseCase,
    private readonly closeConversationUseCase: CloseConversationUseCase,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @ResponseMessage('Your conversations retrieved successfully.')
  @ApiOperation({
    operationId: 'conversationsListMine',
    summary: "List the authenticated Customer's own conversations",
    description:
      "Customer only, ownership-based (not RBAC) - always the caller's own conversations (Customer participant match), cursor-paginated newest-active-first (D13). Excludes Archived by default (D11).",
  })
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
  async listMine(
    @Query() query: ListCustomerConversationsQueryDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<ConversationListResponseDto> {
    const result = await this.listCustomerConversationsUseCase.execute({
      actor,
      includeArchived: query.includeArchived,
      cursor: query.cursor,
      limit: query.limit,
    });
    return toConversationListResponse(result);
  }

  @Post()
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Conversation started successfully.')
  @ApiOperation({
    operationId: 'conversationsStart',
    summary: 'Start a conversation',
    description:
      'Shared: a Customer actor starts a conversation about themselves (customerUserId ignored); a Restaurant-side actor (Employee/OrganizationMember, D15) starts one on behalf of a specific customer via customerUserId.',
  })
  @ApiResponse({ status: 201, description: 'Conversation started', type: ConversationResponseDto })
  @ApiErrorResponse(
    400,
    'Invalid request body, or branchId/reservationId does not belong to restaurantId',
    ['VALIDATION_ERROR'],
  )
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Restaurant-side actor lacks the required role/permission/branch scope', [
    'PERMISSION_DENIED',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(404, 'restaurantId not found, or not accessible to the caller', ['NOT_FOUND'])
  async start(
    @Body() body: StartConversationRequestDto,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<ConversationResponseDto> {
    const result = await this.startConversationUseCase.execute({
      actor,
      restaurantId: body.restaurantId,
      branchId: body.branchId ?? null,
      reservationId: body.reservationId ?? null,
      subject: body.subject ?? null,
      customerUserId: body.customerUserId,
      correlationId: correlationId(request),
    });
    return toConversationResponse(result);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @ResponseMessage('Conversation retrieved successfully.')
  @ApiOperation({
    operationId: 'conversationsGet',
    summary: 'Get a single conversation',
    description: 'Shared - the Customer participant, or an authorized Restaurant-side actor (D15).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Conversation retrieved',
    type: ConversationResponseDto,
  })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(404, 'Conversation not found, or not accessible to the caller', ['NOT_FOUND'])
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<ConversationResponseDto> {
    const result = await this.getConversationUseCase.execute({ actor, conversationId: id });
    return toConversationResponse(result);
  }

  @Get(':id/messages')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @ResponseMessage('Messages retrieved successfully.')
  @ApiOperation({
    operationId: 'conversationsListMessages',
    summary: 'List messages in a conversation',
    description:
      'Shared. Cursor-paginated (D13) on (createdAt, id), newest first, default 50 / max 100.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Messages retrieved', type: MessageListResponseDto })
  @ApiErrorResponse(400, 'Invalid cursor or limit', ['VALIDATION_ERROR'])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(404, 'Conversation not found, or not accessible to the caller', ['NOT_FOUND'])
  async listMessages(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CursorPaginationQueryDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<MessageListResponseDto> {
    const result = await this.listMessagesUseCase.execute({
      actor,
      conversationId: id,
      cursor: query.cursor,
      limit: query.limit,
    });
    return toMessageListResponse(result);
  }

  @Post(':id/messages')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, MessagingSendRateLimitGuard)
  @UseInterceptors(
    MessagingIdempotencyInterceptor,
    FileInterceptor('file', { limits: { fileSize: MESSAGE_ATTACHMENT_MAX_SIZE_BYTES, files: 1 } }),
  )
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        body: { type: 'string', maxLength: 4000 },
        messageType: { type: 'string' },
        file: { type: 'string', format: 'binary' },
      },
      required: ['body'],
    },
  })
  @ResponseMessage('Message sent successfully.')
  @ApiOperation({
    operationId: 'conversationsSendMessage',
    summary: 'Send a message',
    description:
      'Shared. Rate-limited per participant (D8). Supports an optional Idempotency-Key header (D12) and an optional single multipart image attachment (JPEG/PNG/WebP, 5MB max, D7). Auto-reopens a Closed/Archived conversation (D5).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Message sent', type: MessageResponseDto })
  @ApiErrorResponse(400, 'Invalid body, or the attachment is not a valid supported image', [
    'VALIDATION_ERROR',
    'INVALID_FILE',
  ])
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(403, 'Restaurant-side actor lacks the required role/permission/branch scope', [
    'PERMISSION_DENIED',
    'EMPLOYEE_BRANCH_NOT_ASSIGNED',
  ])
  @ApiErrorResponse(404, 'Conversation not found, or not accessible to the caller', ['NOT_FOUND'])
  @ApiErrorResponse(413, 'Attachment file exceeds the maximum allowed size', ['FILE_TOO_LARGE'])
  @ApiErrorResponse(415, 'Unsupported attachment file type', ['UNSUPPORTED_FILE_TYPE'])
  @ApiErrorResponse(429, 'Per-participant send rate limit exceeded', ['RATE_LIMIT_EXCEEDED'])
  @ApiErrorResponse(503, 'Attachment storage is temporarily unavailable', ['STORAGE_UNAVAILABLE'])
  async sendMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SendMessageRequestDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MessageResponseDto> {
    const result = await this.sendMessageUseCase.execute({
      actor,
      conversationId: id,
      body: body.body,
      messageType: body.messageType,
      attachment: file
        ? { buffer: file.buffer, mimeType: file.mimetype, sizeBytes: file.size }
        : null,
      correlationId: correlationId(request),
    });
    return toMessageResponse(result);
  }

  @Post(':id/read')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Conversation marked as read.')
  @ApiOperation({
    operationId: 'conversationsMarkRead',
    summary: 'Mark a conversation as read',
    description:
      "Shared. Updates the caller's own participant lastReadAt (per-person read receipts).",
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Marked as read',
    type: MarkConversationReadResponseDto,
  })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(404, 'Conversation not found, or not accessible to the caller', ['NOT_FOUND'])
  async markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<MarkConversationReadResponseDto> {
    const result = await this.markConversationReadUseCase.execute({
      actor,
      conversationId: id,
      correlationId: correlationId(request),
    });
    return toMarkConversationReadResponse(result);
  }

  @Post(':id/close')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Conversation closed successfully.')
  @ApiOperation({
    operationId: 'conversationsClose',
    summary: 'Close (or archive) a conversation',
    description:
      'Shared, actor-branched (D5): a Restaurant-side actor closes it for both sides (status: Closed); the Customer participant archives it for themselves only (status: Archived). Either auto-reopens on the next message.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Conversation closed/archived',
    type: ConversationResponseDto,
  })
  @ApiErrorResponse(401, 'Access token is missing, invalid, or expired', [
    'AUTH_INVALID_TOKEN',
    'AUTH_EXPIRED_TOKEN',
  ])
  @ApiErrorResponse(404, 'Conversation not found, or not accessible to the caller', ['NOT_FOUND'])
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedActor,
    @Req() request: Request,
  ): Promise<ConversationResponseDto> {
    const result = await this.closeConversationUseCase.execute({
      actor,
      conversationId: id,
      correlationId: correlationId(request),
    });
    return toConversationResponse(result);
  }
}
