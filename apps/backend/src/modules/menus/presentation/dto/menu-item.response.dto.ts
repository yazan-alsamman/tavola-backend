import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MenuItemAvailabilityMode, MenuItemDietaryLabel } from '../../domain/enums/menu-item.enums';

export class MenuItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() categoryId!: string;
  @ApiProperty() restaurantId!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty() price!: number;
  @ApiPropertyOptional({ nullable: true }) currency!: string | null;
  @ApiPropertyOptional({ nullable: true }) imageFileId!: string | null;
  @ApiProperty({ enum: MenuItemAvailabilityMode }) availabilityMode!: MenuItemAvailabilityMode;
  @ApiProperty() isFeatured!: boolean;
  @ApiPropertyOptional({ nullable: true }) preparationTimeMinutes!: number | null;
  @ApiPropertyOptional({ nullable: true }) spicyLevel!: number | null;
  @ApiPropertyOptional({ nullable: true }) calories!: number | null;
  @ApiProperty({ type: [String] }) allergens!: string[];
  @ApiProperty({ enum: MenuItemDietaryLabel, isArray: true })
  dietaryLabels!: MenuItemDietaryLabel[];
  @ApiProperty() displayOrder!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
