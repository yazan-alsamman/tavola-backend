import { ApiProperty } from '@nestjs/swagger';

export class RestaurantLookupResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty({ nullable: true })
  deletedAt!: string | null;
}

export class RestaurantLookupListResponseDto {
  @ApiProperty({ type: [RestaurantLookupResponseDto] })
  items!: RestaurantLookupResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}
