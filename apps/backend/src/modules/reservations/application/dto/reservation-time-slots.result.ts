export const ReservationSlotOutcome = {
  Available: 'AVAILABLE',
  Closed: 'CLOSED',
  NoSuitableTable: 'NO_SUITABLE_TABLE',
  NoRemainingSlots: 'NO_REMAINING_SLOTS',
} as const;

export type ReservationSlotOutcome =
  (typeof ReservationSlotOutcome)[keyof typeof ReservationSlotOutcome];

export interface ReservationTimeSlotResult {
  /** Absolute window start. Send this as reservationStartTime. */
  startTime: string;
  /** Absolute window end. Send this as reservationEndTime. */
  endTime: string;
}

export interface ReservationTimeSlotsResult {
  branchId: string;
  date: string;
  timezone: string;
  dayOfWeek: number;
  openingTime: string | null;
  closingTime: string | null;
  intervalMinutes: number;
  durationMinutes: number;
  outcome: ReservationSlotOutcome;
  slots: ReservationTimeSlotResult[];
}
