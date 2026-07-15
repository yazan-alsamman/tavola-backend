import { ApiProperty } from '@nestjs/swagger';
import { DeviceType } from '../../domain/enums/authentication.enums';

export class ActiveSessionResponseDto {
  @ApiProperty({ format: 'uuid' })
  sessionId!: string;

  @ApiProperty({ nullable: true, example: 'Chrome on Windows' })
  deviceName!: string | null;

  @ApiProperty({ enum: DeviceType, example: DeviceType.Web })
  deviceType!: DeviceType;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastUsedAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ example: true })
  isCurrentSession!: boolean;

  @ApiProperty({ nullable: true, example: '203.0.113.10' })
  ipAddress!: string | null;
}

export class ListActiveSessionsResponseDto {
  @ApiProperty({ type: [ActiveSessionResponseDto] })
  sessions!: ActiveSessionResponseDto[];
}
