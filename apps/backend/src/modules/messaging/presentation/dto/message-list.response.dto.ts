import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageResponseDto } from './message.response.dto';

export class MessageListResponseDto {
  @ApiProperty({ type: [MessageResponseDto] })
  items!: MessageResponseDto[];

  @ApiPropertyOptional({
    nullable: true,
    description: 'Opaque cursor for the next (older) page, or null if there is no further page.',
  })
  nextCursor!: string | null;
}
