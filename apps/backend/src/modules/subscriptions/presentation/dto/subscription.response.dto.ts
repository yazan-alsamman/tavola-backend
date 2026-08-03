import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SubscriptionStatus } from '@modules/subscriptions/domain/enums/subscription.enums';

export class SubscriptionResponseDto {
  @ApiProperty({ format: 'uuid' })
  subscriptionId!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  planId!: string;

  @ApiProperty({
    enum: SubscriptionStatus,
    description:
      'Entitlement/access-contract lifecycle only (ADR-027) - no billing-derived states. Active permits new resource creation; Suspended/Cancelled/Expired do not.',
  })
  status!: SubscriptionStatus;

  @ApiProperty({ format: 'date-time' })
  startsAt!: string;

  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description: 'null = indefinite (default).',
  })
  endsAt!: string | null;
}
