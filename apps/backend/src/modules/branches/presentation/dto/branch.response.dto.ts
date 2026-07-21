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

  @ApiProperty({ example: 'Asia/Damascus' })
  timezone!: string;

  @ApiPropertyOptional({ example: '+963900000000', nullable: true })
  phone!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
