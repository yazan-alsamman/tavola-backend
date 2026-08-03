import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsInt, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class AvailabilityWindowDto {
  @ApiProperty({ example: 1, minimum: 0, maximum: 6, description: '0 = Sunday .. 6 = Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty({ example: '08:00' })
  @IsString()
  @Matches(TIME_PATTERN)
  startTime!: string;

  @ApiProperty({ example: '11:00' })
  @IsString()
  @Matches(TIME_PATTERN)
  endTime!: string;
}

/** ADR-032: whole-set bulk replacement of a Menu Item's availability windows. */
export class ReplaceAvailabilityWindowsRequestDto {
  @ApiProperty({ type: [AvailabilityWindowDto] })
  @ValidateNested({ each: true })
  @Type(() => AvailabilityWindowDto)
  @ArrayMaxSize(50)
  windows!: AvailabilityWindowDto[];
}
