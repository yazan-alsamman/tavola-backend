import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageSenderType, MessageType } from '@modules/messaging/domain/enums/messaging.enums';

export class MessageResponseDto {
  @ApiProperty({ format: 'uuid' })
  messageId!: string;

  @ApiProperty({ format: 'uuid' })
  conversationId!: string;

  @ApiProperty({ enum: MessageSenderType })
  senderType!: MessageSenderType;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  senderUserId!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  senderEmployeeId!: string | null;

  @ApiProperty()
  body!: string;

  @ApiProperty({ enum: MessageType })
  messageType!: MessageType;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  attachmentFileId!: string | null;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description: 'Set when this message has been GDPR-anonymized (DECISIONS.md D10).',
  })
  anonymizedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
