import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_FORMAT_MESSAGE = 'must be in HH:mm 24-hour format';

export class BranchWorkingHoursEntryRequestDto {
  @ApiProperty({ example: 1, minimum: 0, maximum: 6, description: '0=Sunday..6=Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @ApiProperty({ example: '09:00' })
  @IsString()
  @Matches(TIME_PATTERN, { message: `openingTime ${TIME_FORMAT_MESSAGE}` })
  openingTime!: string;

  @ApiProperty({ example: '22:00' })
  @IsString()
  @Matches(TIME_PATTERN, { message: `closingTime ${TIME_FORMAT_MESSAGE}` })
  closingTime!: string;

  @ApiPropertyOptional({ example: null, nullable: true })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, { message: `breakStartTime ${TIME_FORMAT_MESSAGE}` })
  breakStartTime?: string | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, { message: `breakEndTime ${TIME_FORMAT_MESSAGE}` })
  breakEndTime?: string | null;
}

/**
 * Full-replace semantics, matching `UpdateWorkingHoursRequestDto`'s
 * established convention: `entries` becomes the branch's entire week - a day
 * not present in `entries` has no override for that branch. Branch-level
 * only; no `restaurantId`/`branchId` field on this DTO (both come from the URL).
 */
export class UpdateBranchWorkingHoursRequestDto {
  @ApiProperty({ type: () => BranchWorkingHoursEntryRequestDto, isArray: true })
  @IsArray()
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => BranchWorkingHoursEntryRequestDto)
  entries!: BranchWorkingHoursEntryRequestDto[];
}
