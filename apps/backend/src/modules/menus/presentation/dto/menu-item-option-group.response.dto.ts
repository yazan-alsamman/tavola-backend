import { ApiProperty } from '@nestjs/swagger';

export class MenuItemOptionGroupResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() menuItemId!: string;
  @ApiProperty() restaurantId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() required!: boolean;
  @ApiProperty() minSelections!: number;
  @ApiProperty() maxSelections!: number;
  @ApiProperty() displayOrder!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
