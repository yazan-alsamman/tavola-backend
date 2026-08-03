export interface DayBucket {
  date: string;
  count: number;
}

export interface ReservationTrendsResult {
  serviceDayTrend: DayBucket[];
  bookingCreatedTrend: DayBucket[];
  generatedAt: string;
}
