import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReverseAcquisitionRequestDto {
  @ApiProperty({ example: 'Duplicate reservation mistakenly approved twice.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
