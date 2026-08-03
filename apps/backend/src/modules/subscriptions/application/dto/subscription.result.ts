import { SubscriptionStatus } from '../../domain/enums/subscription.enums';

export interface SubscriptionResult {
  subscriptionId: string;
  organizationId: string;
  planId: string;
  status: SubscriptionStatus;
  startsAt: Date;
  endsAt: Date | null;
}
