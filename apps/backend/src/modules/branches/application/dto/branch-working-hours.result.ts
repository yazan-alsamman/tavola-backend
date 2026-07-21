export interface BranchWorkingHoursEntryResult {
  dayOfWeek: number;
  openingTime: string;
  closingTime: string;
  breakStartTime: string | null;
  breakEndTime: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BranchWorkingHoursResult {
  branchId: string;
  entries: BranchWorkingHoursEntryResult[];
}
