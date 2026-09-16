import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '@common/dto/pagination-query.dto';
import { EmptyStringToUndefined } from '@common/decorators/empty-to-undefined.decorator';
import {
  NotificationBroadcastSenderType,
  NotificationBroadcastStatus,
} from '../../domain/enums/notification-broadcast.enums';

export class ListNotificationBroadcastsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: NotificationBroadcastStatus,
    example: NotificationBroadcastStatus.Completed,
    description: 'Filters on the persisted broadcast status. Omitted returns every status.',
  })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(Object.values(NotificationBroadcastStatus))
  status?: NotificationBroadcastStatus;

  @ApiPropertyOptional({
    enum: NotificationBroadcastSenderType,
    example: NotificationBroadcastSenderType.PlatformAdmin,
    description:
      'Omitted returns both Platform Admin and Restaurant Owner broadcasts - a Platform Owner auditing outbound messaging generally wants all of it.',
  })
  @EmptyStringToUndefined()
  @IsOptional()
  @IsIn(Object.values(NotificationBroadcastSenderType))
  senderType?: NotificationBroadcastSenderType;
}

export class NotificationBroadcastHistoryResponseDto {
  @ApiProperty({ format: 'uuid', example: 'b81c4f60-9d2e-4a73-8f15-6c0b3e7d2a49' })
  id!: string;

  @ApiProperty({
    enum: NotificationBroadcastSenderType,
    example: NotificationBroadcastSenderType.PlatformAdmin,
  })
  senderType!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'The Platform Admin or OrganizationMember User id that authored the broadcast.',
    example: '9f14c2a1-7b3e-4d58-9a6f-21c8e4b0d375',
  })
  senderId!: string;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    example: null,
    description:
      'Audit/traceability only, and only for an OrganizationMember sender. Never scopes the audience, which is always platform-wide.',
  })
  organizationId!: string | null;

  @ApiProperty({ example: 'Scheduled maintenance' })
  title!: string;

  @ApiProperty({ example: 'Tavla will be briefly unavailable on Sunday 02:00-03:00 UTC.' })
  body!: string;

  @ApiProperty({
    nullable: true,
    example: 12840,
    description:
      'Audience size snapshot taken when the broadcast was queued. Null until resolved. Observability only - the live audience can shift before the fan-out runs, so this is not a guarantee the fan-out matches it.',
  })
  totalRecipients!: number | null;

  @ApiProperty({
    example: 12840,
    description: 'Advances by the full batch size per processed batch.',
  })
  processedCount!: number;

  @ApiProperty({ example: 12836, description: 'Notification rows actually inserted.' })
  succeededCount!: number;

  @ApiProperty({
    example: 4,
    description:
      'Rows skipped as already-delivered on a retried batch. Not an error count - a resumed broadcast legitimately re-covers recipients it already reached.',
  })
  failedCount!: number;

  @ApiProperty({
    enum: NotificationBroadcastStatus,
    example: NotificationBroadcastStatus.Completed,
    description:
      'Real persisted state: Pending (queued, fan-out not started), Processing (in progress), Completed (audience exhausted), Failed (terminal, after BullMQ retries were exhausted).',
  })
  status!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-09-14T09:00:00.000Z',
    description: 'When the broadcast was queued.',
  })
  createdAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-09-14T09:04:37.512Z',
    description: 'Last counter or status write - effectively when delivery last progressed.',
  })
  updatedAt!: string;
}

export class NotificationBroadcastHistoryListResponseDto {
  @ApiProperty({ type: [NotificationBroadcastHistoryResponseDto] })
  items!: NotificationBroadcastHistoryResponseDto[];

  @ApiProperty({ example: 27 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;
}
