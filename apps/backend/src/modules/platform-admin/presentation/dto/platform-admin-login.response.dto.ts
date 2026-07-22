import { ApiProperty } from '@nestjs/swagger';

export class PlatformAdminLoginResponseDto {
  @ApiProperty({
    description: 'JWT access token, signed with the isolated Platform Admin issuer/audience',
  })
  accessToken!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  accessTokenExpiresAt!: string;
}
