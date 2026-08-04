import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** ADR-035 §3 - deliberately includes `organizationId`, unlike the customer-facing `RestaurantResponseDto`. */
export class PlatformAdminRestaurantResponseDto {
  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  deletedAt!: string | null;
}
