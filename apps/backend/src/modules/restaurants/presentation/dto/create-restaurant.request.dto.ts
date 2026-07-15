import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateRestaurantRequestDto {
  @ApiProperty({ example: 'The Old Mill' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({
    example: 'the-old-mill',
    description: 'Derived from name when omitted.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase, hyphen-separated alphanumeric segments',
  })
  @MaxLength(200)
  slug?: string;

  @ApiPropertyOptional({ example: 'A cozy neighborhood restaurant.', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ example: 'Italian', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cuisineType?: string | null;

  @ApiPropertyOptional({ example: 2, nullable: true, minimum: 1, maximum: 4 })
  @IsOptional()
  @IsInt()
  @IsIn([1, 2, 3, 4])
  priceLevel?: number | null;
}
