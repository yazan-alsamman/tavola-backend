import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class PlatformDashboardQueryDto {
  @ApiProperty({ description: 'Applies only to the acquisition/revenue section.' })
  @IsDateString()
  from!: string;

  @ApiProperty({ description: 'Applies only to the acquisition/revenue section.' })
  @IsDateString()
  to!: string;
}
