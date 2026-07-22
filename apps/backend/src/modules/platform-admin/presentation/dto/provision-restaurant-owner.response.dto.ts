import { ApiProperty } from '@nestjs/swagger';

export class ProvisionRestaurantOwnerResponseDto {
  @ApiProperty({ example: '11111111-1111-4111-8111-111111111111' })
  userId!: string;

  @ApiProperty({ example: 'owner@example.com' })
  email!: string;

  @ApiProperty({ example: '22222222-2222-4222-8222-222222222222' })
  organizationId!: string;

  @ApiProperty({ example: 'acme-restaurant-group' })
  organizationSlug!: string;

  @ApiProperty({ example: 'Acme Restaurant Group' })
  organizationName!: string;
}
