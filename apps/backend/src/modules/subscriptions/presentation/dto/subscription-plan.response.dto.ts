import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubscriptionPlanResponseDto {
  @ApiProperty({ format: 'uuid' })
  planId!: string;

  @ApiProperty({ example: 'default' })
  name!: string;

  @ApiProperty({ example: 'default' })
  slug!: string;

  @ApiProperty({ example: 10, description: 'Organization-wide total.' })
  maxRestaurants!: number;

  @ApiProperty({
    example: 5,
    description:
      'Per-Restaurant - each Restaurant may have at most this many Branches, not an Organization-wide total.',
  })
  maxBranchesPerRestaurant!: number;

  @ApiProperty({
    example: 20,
    description: 'Per-Restaurant, same semantics as maxBranchesPerRestaurant.',
  })
  maxEmployeesPerRestaurant!: number;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description: 'null = available for new assignment.',
  })
  archivedAt!: string | null;
}
