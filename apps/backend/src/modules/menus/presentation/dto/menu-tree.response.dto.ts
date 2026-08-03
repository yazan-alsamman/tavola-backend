import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MenuItemAvailabilityMode, MenuItemDietaryLabel } from '../../domain/enums/menu-item.enums';

export class AvailabilityWindowResponseDto {
  @ApiProperty() dayOfWeek!: number;
  @ApiProperty() startTime!: string;
  @ApiProperty() endTime!: string;
}

export class MenuItemOptionTreeResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() priceModifier!: number;
  @ApiProperty() active!: boolean;
  @ApiProperty() displayOrder!: number;
}

export class MenuItemOptionGroupTreeResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() required!: boolean;
  @ApiProperty() minSelections!: number;
  @ApiProperty() maxSelections!: number;
  @ApiProperty() displayOrder!: number;
  @ApiProperty({ type: [MenuItemOptionTreeResponseDto] }) options!: MenuItemOptionTreeResponseDto[];
}

export class MenuItemAddOnTreeResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() price!: number;
  @ApiProperty() active!: boolean;
  @ApiProperty() displayOrder!: number;
}

export class MenuItemTreeResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() categoryId!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty() price!: number;
  @ApiPropertyOptional({ nullable: true }) currency!: string | null;
  @ApiPropertyOptional({ nullable: true }) imageUrl!: string | null;
  @ApiProperty({ enum: MenuItemAvailabilityMode }) availabilityMode!: MenuItemAvailabilityMode;
  @ApiProperty() isFeatured!: boolean;
  @ApiPropertyOptional({ nullable: true }) preparationTimeMinutes!: number | null;
  @ApiPropertyOptional({ nullable: true }) spicyLevel!: number | null;
  @ApiPropertyOptional({ nullable: true }) calories!: number | null;
  @ApiProperty({ type: [String] }) allergens!: string[];
  @ApiProperty({ enum: MenuItemDietaryLabel, isArray: true })
  dietaryLabels!: MenuItemDietaryLabel[];
  @ApiProperty() displayOrder!: number;
  @ApiProperty({ type: [MenuItemOptionGroupTreeResponseDto] })
  optionGroups!: MenuItemOptionGroupTreeResponseDto[];
  @ApiProperty({ type: [MenuItemAddOnTreeResponseDto] }) addOns!: MenuItemAddOnTreeResponseDto[];
  @ApiProperty({ type: [AvailabilityWindowResponseDto] })
  availability!: AvailabilityWindowResponseDto[];
}

export class MenuCategoryTreeResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() menuId!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiPropertyOptional({ nullable: true }) imageUrl!: string | null;
  @ApiProperty() displayOrder!: number;
  @ApiProperty({ type: [MenuItemTreeResponseDto] }) items!: MenuItemTreeResponseDto[];
}

export class MenuTreeResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() restaurantId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty() displayOrder!: number;
  @ApiProperty({ type: [MenuCategoryTreeResponseDto] }) categories!: MenuCategoryTreeResponseDto[];
}
