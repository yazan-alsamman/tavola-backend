import { ApiProperty } from '@nestjs/swagger';
import { PlatformAdminRole } from '../../domain/enums/platform-admin.enums';

export class PlatformAdminMeResponseDto {
  @ApiProperty({ format: 'uuid', example: '9f14c2a1-7b3e-4d58-9a6f-21c8e4b0d375' })
  userId!: string;

  @ApiProperty({ format: 'uuid', example: '3c7d5e19-8a42-4f6b-b1d0-9e5a2c8f4013' })
  platformAdminId!: string;

  @ApiProperty({ nullable: true, example: 'admin@tavla.internal' })
  email!: string | null;

  @ApiProperty({ nullable: true, example: 'Farid' })
  firstName!: string | null;

  @ApiProperty({ nullable: true, example: 'Haddad' })
  lastName!: string | null;

  @ApiProperty({
    enum: PlatformAdminRole,
    example: PlatformAdminRole.PlatformAdmin,
    description: 'Read live from the PlatformAdmin row, not echoed from the caller JWT claim.',
  })
  role!: PlatformAdminRole;

  @ApiProperty({ example: 'Active', description: 'Underlying User account status.' })
  status!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-08-04T15:00:00.000Z',
    description: 'When the Platform Admin grant was created (not the User account).',
  })
  platformAdminCreatedAt!: string;
}
