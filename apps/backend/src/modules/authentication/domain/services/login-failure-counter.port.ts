/**
 * Counts failed sign-ins per key within a window (ADR-048). The window starts
 * at the first failure and is not extended by later ones.
 */
export interface LoginFailureCounterPort {
  /** Failures recorded for `key` in the current window. */
  count(key: string): Promise<number>;
  /** Records one failure and returns the new count. */
  increment(key: string, windowSeconds: number): Promise<number>;
  clear(key: string): Promise<void>;
}

export const LOGIN_FAILURE_COUNTER = Symbol('LOGIN_FAILURE_COUNTER');
