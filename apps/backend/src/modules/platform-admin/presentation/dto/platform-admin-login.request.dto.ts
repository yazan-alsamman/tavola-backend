import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PlatformAdminLoginRequestDto {
  @ApiProperty({ example: 'admin@tavla.internal' })
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}
