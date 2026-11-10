import { LoginFailureCounterPort } from '@modules/authentication/domain/services/login-failure-counter.port';

export class InMemoryLoginFailureCounter implements LoginFailureCounterPort {
  readonly counts = new Map<string, number>();

  async count(key: string): Promise<number> {
    return this.counts.get(key) ?? 0;
  }

  async increment(key: string): Promise<number> {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }

  async clear(key: string): Promise<void> {
    this.counts.delete(key);
  }
}
