import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { MessageType } from '@modules/messaging/domain/enums/messaging.enums';

export class SendMessageRequestDto {
  @ApiProperty({ maxLength: 4000, example: 'Is my table still available at 8pm?' })
  @IsString()
  @MaxLength(4000)
  body!: string;

  @ApiPropertyOptional({ enum: MessageType, default: MessageType.Text })
  @IsOptional()
  @IsEnum(MessageType)
  messageType?: MessageType;
}
