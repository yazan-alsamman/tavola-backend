import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class SendNotificationToCustomerRequestDto {
  @ApiProperty({ format: 'uuid', description: 'Must resolve to an eligible Customer.' })
  @IsUUID()
  targetUserId!: string;

  @ApiProperty({ example: 'Your account has been verified' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: 'Thanks for confirming your details - you are all set.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;
}
