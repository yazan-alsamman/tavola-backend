/**
 * ADR-046: asks for the price levels to be recomputed soon after a menu
 * change. Requests within a short window collapse into one run. Best
 * effort: never throws, so a queue outage cannot fail a menu edit (the daily
 * sweep catches up).
 */
export interface MenuPriceLevelSchedulerPort {
  requestRecompute(): Promise<void>;
}

export const MENU_PRICE_LEVEL_SCHEDULER = Symbol('MENU_PRICE_LEVEL_SCHEDULER');
