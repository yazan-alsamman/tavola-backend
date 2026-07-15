import { CallHandler, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';
import { SKIP_RESPONSE_ENVELOPE_KEY } from '../decorators/skip-response-envelope.decorator';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator';

class TestController {
  defaultHandler() {
    return { id: '1' };
  }

  @SetMetadata(RESPONSE_MESSAGE_KEY, 'Created.')
  customMessageHandler() {
    return { id: '1' };
  }

  @SetMetadata(SKIP_RESPONSE_ENVELOPE_KEY, true)
  skipEnvelopeHandler() {
    return { id: '1' };
  }
}

describe('ResponseEnvelopeInterceptor', () => {
  const reflector = new Reflector();
  const interceptor = new ResponseEnvelopeInterceptor(reflector);
  const controller = new TestController();

  const createContext = (handler: object): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => TestController,
    }) as ExecutionContext;

  const next: CallHandler = { handle: () => of({ id: '1' }) };

  it('wraps successful responses in the standard envelope', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(createContext(controller.defaultHandler), next),
    );

    expect(result).toEqual({
      success: true,
      message: 'Request successful.',
      data: { id: '1' },
      meta: {},
    });
  });

  it('uses a custom response message when provided', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(createContext(controller.customMessageHandler), next),
    );

    expect(result).toEqual(expect.objectContaining({ message: 'Created.' }));
  });

  it('passes through when @SkipResponseEnvelope is set', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(createContext(controller.skipEnvelopeHandler), next),
    );

    expect(result).toEqual({ id: '1' });
  });
});
