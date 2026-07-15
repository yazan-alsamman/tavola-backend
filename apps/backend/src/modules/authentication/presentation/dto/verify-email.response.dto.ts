import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '../../domain/enums/authentication.enums';

export class VerifyEmailResponseDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ example: 'owner@example.com' })
  email!: string;

  @ApiProperty({ enum: UserStatus, example: UserStatus.Active })
  status!: UserStatus;
}
