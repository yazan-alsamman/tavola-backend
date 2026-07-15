import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class VerifyEmailRequestDto {
  @ApiProperty({
    description: 'Opaque email verification token from the verification link or email.',
    example: 'k7x9mP2vQwR8nL4jH6tY3sA1bC0dE5fG',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;
}
