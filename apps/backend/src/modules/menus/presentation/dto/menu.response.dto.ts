import { ApiProperty } from '@nestjs/swagger';

export class MenuResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() restaurantId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty() displayOrder!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
