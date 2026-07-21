import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateFloorPlanRequestDto {
  @ApiProperty({ example: 'Main Floor' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;
}
