import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConversationStatus } from '@modules/messaging/domain/enums/messaging.enums';

export class ConversationResponseDto {
  @ApiProperty({ format: 'uuid' })
  conversationId!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  branchId!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  reservationId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  subject!: string | null;

  @ApiProperty({
    enum: ConversationStatus,
    description:
      'Open, or Closed (a Restaurant-side actor closed it for both sides) or Archived (the Customer soft-hid it from their own list). Either auto-reopens to Open on a new Message (DECISIONS.md D5).',
  })
  status!: ConversationStatus;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  lastMessageAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
