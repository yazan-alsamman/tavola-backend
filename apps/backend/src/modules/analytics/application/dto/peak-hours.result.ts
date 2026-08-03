export interface PeakHoursResult {
  /** Exactly 24 entries, index = Branch-local hour (0-23), zero-filled. */
  peakHours: number[];
  generatedAt: string;
}
