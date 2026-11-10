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
} from 'class-validator';
import { MenuItemDietaryLabel } from '../../domain/enums/menu-item.enums';

export class CreateMenuItemRequestDto {
  @ApiPropertyOptional({
    example: 'Margherita Pizza',
    description:
      'Legacy single name (app 1.0.2 era). Prefer nameAr/nameEn; ignored when either is sent.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    example: 'بيتزا مارغريتا',
    description: 'Arabic name. nameAr or nameEn is required.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameAr?: string;

  @ApiPropertyOptional({
    example: 'Margherita Pizza',
    description: 'English name. nameAr or nameEn is required.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameEn?: string;

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
