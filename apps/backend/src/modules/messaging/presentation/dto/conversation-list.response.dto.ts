import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ConversationResponseDto } from './conversation.response.dto';

export class ConversationListResponseDto {
  @ApiProperty({ type: [ConversationResponseDto] })
  items!: ConversationResponseDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Opaque cursor for the next page, or null if there is no further page.',
  })
  nextCursor!: string | null;
}
