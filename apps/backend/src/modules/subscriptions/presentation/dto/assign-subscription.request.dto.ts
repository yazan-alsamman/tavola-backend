import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

/**
 * ADR-027 §7/D9 - PlatformAdmin-only. Serves both initial assignment
 * (`SubscriptionAssigned`) and an immediate plan change on an Active
 * Subscription (`SubscriptionPlanChanged`) - see
 * `AssignSubscriptionUseCase`'s own doc comment. No `effectiveAt`
 * scheduling (D12).
 */
export class AssignSubscriptionRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  @IsNotEmpty()
  planId!: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description:
      'Omit for an indefinite subscription (default, D10). When set, schedules automatic expiration (D11).',
  })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;
}
