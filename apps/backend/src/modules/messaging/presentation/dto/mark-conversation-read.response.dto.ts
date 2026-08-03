import { ApiProperty } from '@nestjs/swagger';

export class MarkConversationReadResponseDto {
  @ApiProperty({ format: 'uuid' })
  conversationId!: string;

  @ApiProperty({ format: 'uuid' })
  participantId!: string;

  @ApiProperty({ format: 'date-time' })
  lastReadAt!: string;
}
