export interface WorkingHoursEntryResult {
  dayOfWeek: number;
  openingTime: string;
  closingTime: string;
  breakStartTime: string | null;
  breakEndTime: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkingHoursResult {
  restaurantId: string;
  entries: WorkingHoursEntryResult[];
}
