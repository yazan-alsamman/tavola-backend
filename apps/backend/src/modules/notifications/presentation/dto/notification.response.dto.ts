import { ApiProperty } from '@nestjs/swagger';

/**
 * API_GUIDELINES.md's frozen Notification Endpoints contract - never
 * `pushStatus`/`pushSentAt`/`pushFailedAt`/`pushFailureReason`/
 * `pushIdempotencyKey`/`pushProviderMessageId`.
 */
export class NotificationResponseDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  id!: string;

  @ApiProperty({ example: 'ReservationApproved' })
  type!: string;

  @ApiProperty({ example: 'Reservation confirmed' })
  title!: string;

  @ApiProperty({ example: 'Your reservation has been confirmed.' })
  body!: string;

  @ApiProperty({
    example: { reservationId: '22222222-2222-4222-8222-222222222222' },
    nullable: true,
    type: 'object',
    additionalProperties: true,
  })
  data!: Record<string, unknown> | null;

  @ApiProperty({ example: false })
  read!: boolean;

  @ApiProperty({ example: null, nullable: true })
  readAt!: string | null;

  @ApiProperty({ example: '2026-07-25T12:00:00.000Z' })
  createdAt!: string;
}
