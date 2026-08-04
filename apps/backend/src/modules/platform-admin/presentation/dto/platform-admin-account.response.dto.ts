import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';

export class PlatformAdminAccountResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiPropertyOptional({ nullable: true })
  email!: string | null;

  @ApiProperty({ enum: PlatformAdminRole })
  role!: PlatformAdminRole;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  revokedAt!: string | null;
}

export class PlatformAdminAccountListResponseDto {
  @ApiProperty({ type: () => PlatformAdminAccountResponseDto, isArray: true })
  items!: PlatformAdminAccountResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}
