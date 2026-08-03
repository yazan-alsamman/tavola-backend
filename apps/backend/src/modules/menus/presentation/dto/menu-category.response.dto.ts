import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MenuCategoryResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() menuId!: string;
  @ApiProperty() restaurantId!: string;
  @ApiProperty() name!: string;
  @ApiPropertyOptional({ nullable: true }) description!: string | null;
  @ApiProperty() displayOrder!: number;
  @ApiPropertyOptional({ nullable: true }) imageFileId!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
