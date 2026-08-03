import { ApiProperty } from '@nestjs/swagger';

export class MenuItemOptionResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() optionGroupId!: string;
  @ApiProperty() restaurantId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() priceModifier!: number;
  @ApiProperty() active!: boolean;
  @ApiProperty() displayOrder!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
