import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordResponseDto {
  @ApiProperty({ example: 'Password changed successfully.' })
  message!: string;

  @ApiProperty({ example: 2, description: 'Updated session version after password change.' })
  sessionVersion!: number;

  @ApiProperty({
    example: 'eyJ...',
    description:
      'Freshly signed access token carrying the updated sessionVersion. The password change ' +
      'bumps sessionVersion, which would otherwise invalidate the token used to make this very ' +
      'call; the caller does not need to call /auth/refresh to keep the current session usable. ' +
      'The refresh token is unchanged.',
  })
  accessToken!: string;

  @ApiProperty({ example: '2026-07-11T00:15:00.000Z' })
  accessTokenExpiresAt!: string;
}
