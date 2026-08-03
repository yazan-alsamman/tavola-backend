import { ApiProperty } from '@nestjs/swagger';

class RestaurantUsageEntryDto {
  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ example: 2 })
  branchCount!: number;

  @ApiProperty({ example: 5 })
  maxBranchesPerRestaurant!: number;

  @ApiProperty({ example: 8 })
  employeeCount!: number;

  @ApiProperty({ example: 20 })
  maxEmployeesPerRestaurant!: number;
}

export class SubscriptionUsageResponseDto {
  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ example: 3 })
  restaurantCount!: number;

  @ApiProperty({ example: 10 })
  maxRestaurants!: number;

  @ApiProperty({ type: [RestaurantUsageEntryDto] })
  restaurants!: RestaurantUsageEntryDto[];
}
