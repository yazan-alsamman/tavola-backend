import { ApiProperty } from '@nestjs/swagger';

export class MenuItemAddOnResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() menuItemId!: string;
  @ApiProperty() restaurantId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() price!: number;
  @ApiProperty() active!: boolean;
  @ApiProperty() displayOrder!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
