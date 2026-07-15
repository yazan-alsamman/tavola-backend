import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RefreshSessionRequestDto {
  @ApiProperty({
    description: 'Opaque refresh token issued at login or prior refresh.',
    example: 'k7x9mP2vQwR8nL4jH6tY3sA1bC0dE5fG',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken!: string;
}
