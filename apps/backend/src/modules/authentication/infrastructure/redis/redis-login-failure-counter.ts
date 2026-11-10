import { Inject, Injectable } from '@nestjs/common';
import { REDIS_CACHE_CLIENT } from '@infrastructure/redis/redis.tokens';
import type { RedisCacheClient } from '@infrastructure/redis/redis-cache.client';
import { LoginFailureCounterPort } from '../../domain/services/login-failure-counter.port';

/** INCR and set the expiry on the first failure only, in one atomic script. */
const INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
`;

@Injectable()
export class RedisLoginFailureCounter implements LoginFailureCounterPort {
  constructor(@Inject(REDIS_CACHE_CLIENT) private readonly redis: RedisCacheClient) {}

  async count(key: string): Promise<number> {
    const value = await this.redis.get(key);
    return value === null ? 0 : Number(value);
  }

  async increment(key: string, windowSeconds: number): Promise<number> {
    return (await this.redis.eval(INCREMENT_SCRIPT, 1, key, windowSeconds)) as number;
  }

  async clear(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
