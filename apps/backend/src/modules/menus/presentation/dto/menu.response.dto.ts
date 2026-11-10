import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MenuResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() restaurantId!: string;
  @ApiPropertyOptional({ nullable: true, description: 'Null: shared by every branch (ADR-046).' })
  branchId!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty() active!: boolean;
  @ApiProperty() isDefault!: boolean;
  @ApiProperty() displayOrder!: number;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}
