import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, Min, MaxLength, MinLength } from 'class-validator';

export class UpdateMenuRequestDto {
  @ApiProperty({ example: 'Breakfast Menu' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  displayOrder!: number;
}
