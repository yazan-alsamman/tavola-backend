import { ApiProperty } from '@nestjs/swagger';
import { NotificationResponseDto } from './notification.response.dto';

/**
 * Pagination fields embedded directly in `data` rather than the envelope's
 * `meta` object - same documented judgment call as `FavoriteListResponseDto`
 * (`ResponseEnvelopeInterceptor` hardcodes `meta: {}` today).
 */
export class NotificationListResponseDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  items!: NotificationResponseDto[];

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ example: 1 })
  total!: number;
}
