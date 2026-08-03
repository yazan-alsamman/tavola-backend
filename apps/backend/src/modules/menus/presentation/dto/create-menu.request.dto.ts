import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMenuRequestDto {
  @ApiProperty({ example: 'Breakfast Menu' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}
