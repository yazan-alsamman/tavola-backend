import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PricingFeeType, PricingScopeType } from '../../domain/enums/customer-acquisition.enums';

export class ActivatePricingRuleRequestDto {
  @ApiProperty({ enum: PricingScopeType })
  @IsEnum(PricingScopeType)
  scopeType!: PricingScopeType;

  @ApiPropertyOptional({ format: 'uuid', description: 'Required unless scopeType is Platform.' })
  @ValidateIf((dto: ActivatePricingRuleRequestDto) => dto.scopeType !== PricingScopeType.Platform)
  @IsUUID()
  scopeId?: string;

  @ApiProperty({ enum: PricingFeeType, example: PricingFeeType.Flat })
  @IsEnum(PricingFeeType)
  feeType!: PricingFeeType;

  @ApiProperty({ example: 1000 })
  @IsNumber()
  @Min(0)
  flatAmount!: number;

  @ApiProperty({ example: 'SYP' })
  @IsString()
  @IsNotEmpty()
  flatCurrency!: string;

  @ApiProperty()
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @ApiProperty({ example: 'Default Platform acquisition fee' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  label!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Archives this rule in the same operation (ADR-033 §15).',
  })
  @IsOptional()
  @IsUUID()
  supersedesRuleId?: string;
}
