import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionPlanResponseDto } from './subscription-plan.response.dto';

export class SubscriptionPlanListResponseDto {
  @ApiProperty({ type: [SubscriptionPlanResponseDto] })
  items!: SubscriptionPlanResponseDto[];
}
