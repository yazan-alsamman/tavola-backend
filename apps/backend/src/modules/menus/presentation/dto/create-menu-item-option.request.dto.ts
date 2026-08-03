import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMenuItemOptionRequestDto {
  @ApiProperty({ example: 'Large' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 2.0, description: 'Zero, positive, or negative.' })
  @IsNumber()
  priceModifier!: number;
}
