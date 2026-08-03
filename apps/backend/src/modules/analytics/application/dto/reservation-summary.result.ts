import { ReservationSourceCounts, ReservationStatusCounts } from '../ports/analytics-query.port';

export interface ReservationSummaryResult {
  statusCounts: ReservationStatusCounts;
  sourceBreakdown: ReservationSourceCounts;
  completionRate: number | null;
  noShowRate: number | null;
  cancellationRate: number | null;
  avgPartySize: number | null;
  generatedAt: string;
}
