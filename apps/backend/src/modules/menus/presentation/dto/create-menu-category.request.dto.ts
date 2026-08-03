import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMenuCategoryRequestDto {
  @ApiProperty({ example: 'Appetizers' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'Light bites to start.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
