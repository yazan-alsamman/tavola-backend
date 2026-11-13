import {
  BranchFeature,
  BranchSubscriptionStatus,
  BranchVenueType,
} from '../../domain/enums/branch.enums';
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
    format: 'uuid',
    nullable: true,
    description:
      'ADR-051: File id of the branch cover (set with POST /restaurants/{id}/cover and branchId).',
  })
  coverImageId!: string | null;

  @ApiProperty({ enum: BranchVenueType, nullable: true, description: 'ADR-053' })
  venueType!: BranchVenueType | null;

  @ApiProperty({ enum: BranchFeature, isArray: true, description: 'ADR-053' })
  features!: BranchFeature[];

  @ApiProperty({
    enum: BranchSubscriptionStatus,
    description: 'ADR-053: Trial until trialEndsAt, Paused while the owner paused the branch.',
  })
  subscriptionStatus!: BranchSubscriptionStatus;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'ADR-053' })
  trialEndsAt!: string | null;

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
