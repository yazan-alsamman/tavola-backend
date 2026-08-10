import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class SimulatePricingRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  restaurantId!: string;

  @ApiProperty({ example: 1200 })
  @IsNumber()
  @Min(0)
  proposedFlatAmount!: number;

  @ApiProperty({ example: 'SYP' })
  @IsString()
  @IsNotEmpty()
  proposedFlatCurrency!: string;

  @ApiPropertyOptional({ example: 30, minimum: 1, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  lookbackDays?: number;
}

export class SimulatePricingResponseDto {
  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty()
  lookbackDays!: number;

  @ApiProperty()
  recentAcquisitionCount!: number;

  @ApiProperty()
  proposedFlatAmount!: number;

  @ApiProperty()
  proposedFlatCurrency!: string;

  @ApiProperty()
  projectedCost!: number;

  @ApiProperty({ example: true })
  isEstimateOnly!: true;
}
