import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BranchResponseDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ example: 'Damascus' })
  city!: string;

  @ApiPropertyOptional({ example: 'Malki', nullable: true })
  district!: string | null;

  @ApiProperty({ example: '123 Main St' })
  address!: string;

  @ApiPropertyOptional({ example: 33.5138, nullable: true })
  latitude!: number | null;

  @ApiPropertyOptional({ example: 36.2765, nullable: true })
  longitude!: number | null;

  @ApiProperty({ example: 'SY' })
  countryCode!: string;

  @ApiPropertyOptional({ example: 'SYP', nullable: true })
  currency!: string | null;

  @ApiPropertyOptional({
    example: 'Naranj Malki',
    nullable: true,
    description: "ADR-051: the branch's own name. Null means the restaurant name is shown.",
  })
  name!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      "ADR-051: the branch's own description. Null means the restaurant description is shown.",
  })
  description!: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      'ADR-051: File id of the branch cover (set with POST /restaurants/{id}/cover-image and branchId).',
  })
  coverImageId!: string | null;

  @ApiPropertyOptional({
    example: 40.6,
    nullable: true,
    description:
      'Average price of the menu items ranked 2 to 11 by price, in the branch currency. Recomputed when the menu changes (ADR-046).',
  })
  referencePrice!: number | null;

  @ApiPropertyOptional({
    example: 3,
    minimum: 1,
    maximum: 4,
    nullable: true,
    description: 'Quartile of referencePrice among all branches with the same currency (ADR-046).',
  })
  priceLevel!: number | null;

  @ApiProperty({ example: 'Asia/Damascus' })
  timezone!: string;

  @ApiPropertyOptional({ example: '+963900000000', nullable: true })
  phone!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
