import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MenuItemDietaryLabel } from '../../domain/enums/menu-item.enums';

export class CreateMenuItemRequestDto {
  @ApiProperty({ example: 'Margherita Pizza' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'Tomato, mozzarella, basil.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 12.5 })
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsInt()
  @Min(0)
  preparationTimeMinutes?: number;

  @ApiPropertyOptional({ example: 1, minimum: 0, maximum: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  spicyLevel?: number;

  @ApiPropertyOptional({ example: 800 })
  @IsOptional()
  @IsInt()
  @Min(0)
  calories?: number;

  @ApiPropertyOptional({ type: [String], example: ['gluten', 'dairy'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergens?: string[];

  @ApiPropertyOptional({ enum: MenuItemDietaryLabel, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(MenuItemDietaryLabel, { each: true })
  dietaryLabels?: MenuItemDietaryLabel[];
}
