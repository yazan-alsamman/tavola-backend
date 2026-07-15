import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '../../domain/enums/authentication.enums';
import { AccessTokenActorType } from '../../domain/services/access-token-claims';

export class LoginUserResponseDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ example: 'owner@example.com' })
  email!: string;

  @ApiProperty({ example: 'Jane' })
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  lastName!: string;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;

  @ApiProperty({ example: true })
  emailVerified!: boolean;
}

export class LoginOrganizationResponseDto {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 'Acme Restaurants' })
  name!: string;

  @ApiProperty({ example: 'acme-restaurants' })
  slug!: string;

  @ApiProperty({ example: 'Owner' })
  role!: string;
}

export class LoginResponseDto {
  @ApiProperty({ description: 'JWT access token' })
  accessToken!: string;

  @ApiProperty({ description: 'Opaque refresh token (store securely; shown once)' })
  refreshToken!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  accessTokenExpiresAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  refreshTokenExpiresAt!: string;

  @ApiProperty({ type: LoginUserResponseDto })
  user!: LoginUserResponseDto;

  @ApiProperty({
    type: LoginOrganizationResponseDto,
    nullable: true,
    description:
      'Organization the authenticated actor belongs to, or null for actors with no organization membership',
  })
  organization!: LoginOrganizationResponseDto | null;

  @ApiProperty({ format: 'uuid' })
  sessionId!: string;

  @ApiProperty({ example: 1 })
  sessionVersion!: number;

  @ApiProperty({ example: 1 })
  permissionsVersion!: number;

  @ApiProperty({ enum: AccessTokenActorType, example: AccessTokenActorType.User })
  actorType!: AccessTokenActorType;

  @ApiProperty({ example: false })
  requiresPasswordChange!: boolean;
}
