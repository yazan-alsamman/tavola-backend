import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordRequestDto {
  @ApiProperty({
    description: 'Opaque password reset token from the reset link or email.',
    example: 'k7x9mP2vQwR8nL4jH6tY3sA1bC0dE5fG',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;

  @ApiProperty({
    description: 'New password meeting platform password policy.',
    example: 'NewSecurePass123!',
    minLength: 12,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}
