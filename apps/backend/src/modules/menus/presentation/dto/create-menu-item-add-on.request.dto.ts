import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, Min, MaxLength, MinLength } from 'class-validator';

export class CreateMenuItemAddOnRequestDto {
  @ApiProperty({ example: 'Extra Cheese' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 1.5 })
  @IsNumber()
  @Min(0)
  price!: number;
}
