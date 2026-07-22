import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '../../domain/enums/authentication.enums';
import { AccessTokenActorType } from '../../domain/services/access-token-claims';

export class CustomerLoginUserResponseDto {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ example: 'jane_doe' })
  username!: string;

  @ApiProperty({ example: '+963912345678' })
  phone!: string;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;
}

export class CustomerLoginResponseDto {
  @ApiProperty({ description: 'JWT access token' })
  accessToken!: string;

  @ApiProperty({ description: 'Opaque refresh token (store securely; shown once)' })
  refreshToken!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  accessTokenExpiresAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  refreshTokenExpiresAt!: string;

  @ApiProperty({ type: CustomerLoginUserResponseDto })
  user!: CustomerLoginUserResponseDto;

  @ApiProperty({ format: 'uuid' })
  sessionId!: string;

  @ApiProperty({ example: 1 })
  sessionVersion!: number;

  @ApiProperty({ example: 1 })
  permissionsVersion!: number;

  @ApiProperty({ enum: AccessTokenActorType, example: AccessTokenActorType.User })
  actorType!: AccessTokenActorType;
}
