import { ApiProperty } from '@nestjs/swagger';

export class MenuImageResponseDto {
  @ApiProperty() imageUrl!: string;
}
