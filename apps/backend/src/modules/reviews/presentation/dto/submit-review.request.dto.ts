import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class ReviewAxisRequestDto {
  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ example: 'Quick and friendly.', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string | null;
}

/** Stars and a comment for each of the three axes (ADR-045). */
export class ReviewAxesRequestDto {
  @ApiProperty({ type: ReviewAxisRequestDto })
  @ValidateNested()
  @Type(() => ReviewAxisRequestDto)
  service!: ReviewAxisRequestDto;

  @ApiProperty({ type: ReviewAxisRequestDto })
  @ValidateNested()
  @Type(() => ReviewAxisRequestDto)
  place!: ReviewAxisRequestDto;

  @ApiProperty({ type: ReviewAxisRequestDto })
  @ValidateNested()
  @Type(() => ReviewAxisRequestDto)
  food!: ReviewAxisRequestDto;
}

/**
 * The rating body shared by submit and re-rate. Send `axes` (three-axis
 * review; `rating` is then derived from their average) or `rating` alone
 * (single-rating review, app 1.0.2).
 */
export class ReviewContentRequestDto {
  @ApiPropertyOptional({
    example: 5,
    minimum: 1,
    maximum: 5,
    description: 'Required without `axes`; ignored when `axes` is sent.',
  })
  @ValidateIf((dto: ReviewContentRequestDto) => dto.axes === undefined || dto.axes === null)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ example: 'Wonderful evening, great service.', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string | null;

  @ApiPropertyOptional({ type: ReviewAxesRequestDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => ReviewAxesRequestDto)
  axes?: ReviewAxesRequestDto | null;

  @ApiPropertyOptional({
    example: 'The music was too loud near the door.',
    nullable: true,
    description: 'Reaches the restaurant only; never published.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  privateNote?: string | null;
}

export class SubmitReviewRequestDto extends ReviewContentRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  reservationId!: string;
}
