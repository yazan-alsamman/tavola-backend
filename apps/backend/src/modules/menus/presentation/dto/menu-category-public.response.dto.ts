import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MenuCategoryPublicResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() menuId!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiPropertyOptional({ nullable: true }) imageUrl!: string | null;
  @ApiProperty() displayOrder!: number;
}
