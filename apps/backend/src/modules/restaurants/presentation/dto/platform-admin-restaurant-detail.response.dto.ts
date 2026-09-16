import { ApiProperty } from '@nestjs/swagger';

/**
 * The owning Organization, embedded so the console can render "which org
 * owns this" without a second round trip. Deliberately a summary, not the
 * full organization detail resource - that lives at
 * `GET /platform-admin/organizations/:id`.
 */
export class PlatformAdminRestaurantOrganizationDto {
  @ApiProperty({ format: 'uuid', example: '7a1f3d92-4c8b-4e15-9f20-6d3b8c1a5e04' })
  id!: string;

  @ApiProperty({ example: 'Acme Hospitality Group' })
  name!: string;

  @ApiProperty({ example: 'acme-hospitality-group' })
  slug!: string;

  @ApiProperty({ example: 'Active' })
  status!: string;
}

export class PlatformAdminRestaurantDetailResponseDto {
  @ApiProperty({ format: 'uuid', example: 'c4e91b07-2a63-4f88-b5d1-3e7a9c204f16' })
  id!: string;

  @ApiProperty({ type: PlatformAdminRestaurantOrganizationDto })
  organization!: PlatformAdminRestaurantOrganizationDto;

  @ApiProperty({ example: 'The Old Mill' })
  name!: string;

  @ApiProperty({ example: 'the-old-mill' })
  slug!: string;

  @ApiProperty({ nullable: true, example: 'A cozy neighborhood restaurant.' })
  description!: string | null;

  @ApiProperty({ nullable: true, example: 'Italian' })
  cuisineType!: string | null;

  @ApiProperty({ nullable: true, example: 2, minimum: 1, maximum: 4 })
  priceLevel!: number | null;

  @ApiProperty({ nullable: true, example: 4.35, description: 'Null until the first review.' })
  averageRating!: number | null;

  @ApiProperty({ nullable: true, format: 'uuid', example: null })
  logoId!: string | null;

  @ApiProperty({ nullable: true, format: 'uuid', example: null })
  coverImageId!: string | null;

  @ApiProperty({ example: 'Active', description: 'Active or Suspended. Soft delete is deletedAt.' })
  status!: string;

  @ApiProperty({ example: 3, description: 'Live branches; excludes soft-deleted ones.' })
  branchCount!: number;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-05-02T09:14:22.101Z' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-09-01T16:40:05.882Z' })
  updatedAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
    description: 'Non-null for a soft-deleted Restaurant, which this endpoint still returns.',
  })
  deletedAt!: string | null;
}
