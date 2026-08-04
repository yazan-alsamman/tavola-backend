import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class PlatformAdminResetCredentialsRequestDto {
  @ApiProperty({ example: 'NewSecurePass123!', minLength: 12 })
  @IsString()
  @IsNotEmpty()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}
