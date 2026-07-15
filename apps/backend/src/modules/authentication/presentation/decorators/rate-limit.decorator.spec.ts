import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_KEY, RateLimit } from './rate-limit.decorator';

class TestController {
  @RateLimit('login')
  loginHandler() {
    return null;
  }

  unprotectedHandler() {
    return null;
  }
}

describe('RateLimit decorator', () => {
  const reflector = new Reflector();
  const controller = new TestController();

  it('stores the policy name as handler-level metadata', () => {
    const metadata = reflector.get<string>(RATE_LIMIT_KEY, controller.loginHandler);
    expect(metadata).toBe('login');
  });

  it('leaves handlers without the decorator with no metadata', () => {
    const metadata = reflector.get<string | undefined>(
      RATE_LIMIT_KEY,
      controller.unprotectedHandler,
    );
    expect(metadata).toBeUndefined();
  });
});
