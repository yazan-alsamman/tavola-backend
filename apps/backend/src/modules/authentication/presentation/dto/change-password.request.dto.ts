import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordRequestDto {
  @ApiProperty({
    description: 'Current account password.',
    example: 'SecurePass123!',
    minLength: 12,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(12)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({
    description: 'New password meeting platform password policy.',
    example: 'BrandNewPass1!',
    minLength: 12,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}
