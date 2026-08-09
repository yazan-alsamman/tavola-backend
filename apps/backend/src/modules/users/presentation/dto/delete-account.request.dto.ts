import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class DeleteAccountRequestDto {
  @ApiProperty({
    description: 'Current account password - required to confirm this destructive request.',
    example: 'SecurePass123!',
    minLength: 12,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
