import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendNotificationBroadcastRequestDto {
  @ApiProperty({ example: 'We are open this holiday!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: 'Join us for a special holiday menu, available all week.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;
}
