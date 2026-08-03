import { WaitlistStatusCounts } from '../ports/analytics-query.port';

export interface WaitlistAnalyticsResult {
  waitlistEntries: WaitlistStatusCounts;
  waitlistConversionRate: number | null;
  generatedAt: string;
}
