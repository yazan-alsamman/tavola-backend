import { ApiProperty } from '@nestjs/swagger';

export class PlatformAdminOrganizationDetailResponseDto {
  @ApiProperty({ format: 'uuid', example: '7a1f3d92-4c8b-4e15-9f20-6d3b8c1a5e04' })
  id!: string;

  @ApiProperty({ example: 'Acme Hospitality Group' })
  name!: string;

  @ApiProperty({ example: 'acme-hospitality-group' })
  slug!: string;

  @ApiProperty({
    example: 'Active',
    description: 'Active or Suspended. Soft delete is the separate deletedAt field.',
  })
  status!: string;

  @ApiProperty({ example: 'billing@acme-hospitality.com' })
  billingEmail!: string;

  @ApiProperty({ example: 4, description: 'Live restaurants; excludes soft-deleted ones.' })
  restaurantCount!: number;

  @ApiProperty({ example: 7, description: 'Active members; excludes Invited and Removed.' })
  memberCount!: number;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-03-18T11:02:44.318Z' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-08-27T08:19:51.664Z' })
  updatedAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'Non-null for a soft-deleted Organization, which this endpoint still returns.',
  })
  deletedAt!: string | null;
}
