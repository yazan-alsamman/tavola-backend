export interface SimulatePricingCommand {
  restaurantId: string;
  proposedFlatAmount: number;
  proposedFlatCurrency: string;
  /** Trailing window used to project volume - default 30 days. */
  lookbackDays?: number;
}

export interface SimulatePricingResult {
  restaurantId: string;
  lookbackDays: number;
  recentAcquisitionCount: number;
  proposedFlatAmount: number;
  proposedFlatCurrency: string;
  /** `proposedFlatAmount * recentAcquisitionCount` - illustrative only, never a commitment (ADR-033 §19). */
  projectedCost: number;
  isEstimateOnly: true;
}
