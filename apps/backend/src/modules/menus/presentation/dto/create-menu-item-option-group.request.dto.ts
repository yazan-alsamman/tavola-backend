import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsString, Min, MaxLength, MinLength } from 'class-validator';

export class CreateMenuItemOptionGroupRequestDto {
  @ApiProperty({ example: 'Choose your size' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  required!: boolean;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  minSelections!: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  maxSelections!: number;
}
