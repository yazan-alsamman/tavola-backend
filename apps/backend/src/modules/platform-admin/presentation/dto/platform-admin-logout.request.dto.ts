import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class PlatformAdminLogoutRequestDto {
  @ApiProperty({
    description:
      'The refresh token identifying which session to end. Required because Platform Admin access tokens carry no sessionId claim (AUTHENTICATION_ARCHITECTURE.md §5.2 keeps those claims minimal).',
    example: 'qT7bZ1xK9wN4mR2hV6yD3sA8cF0eJ5gU',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken!: string;
}
