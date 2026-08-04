import { ApiProperty } from '@nestjs/swagger';

export class PlatformAdminOrganizationResponseDto {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class OwnershipTransferResponseDto {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  previousOwnerUserId!: string;

  @ApiProperty({ format: 'uuid' })
  newOwnerUserId!: string;
}
