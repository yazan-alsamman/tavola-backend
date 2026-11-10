/** ADR-046: recomputes branch price levels after menu edits and once a day. */
export const MENU_PRICE_LEVEL_QUEUE_NAME = 'MenuPriceLevelQueue';

export const MENU_PRICE_LEVEL_JOB_NAME = 'menu-price-level-recompute';

/** One pending on-demand job at a time: edits inside the delay share it. */
export const MENU_PRICE_LEVEL_PENDING_JOB_ID = 'menu-price-level-pending';

export const MENU_PRICE_LEVEL_DEBOUNCE_MS = 30_000;

export const MENU_PRICE_LEVEL_SCHEDULER_ID = 'menu-price-level-daily';

/** Every day at 03:30 UTC. */
export const MENU_PRICE_LEVEL_CRON = '30 3 * * *';
