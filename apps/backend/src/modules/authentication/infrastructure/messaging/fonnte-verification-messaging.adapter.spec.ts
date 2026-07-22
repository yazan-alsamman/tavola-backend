import { ConfigService } from '@nestjs/config';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { FonnteConfig } from '@config/fonnte.config';
import { FonnteVerificationMessagingAdapter } from './fonnte-verification-messaging.adapter';

/**
 * Never uses a real Fonnte token - `apiToken` below is a fixture value only,
 * and `global.fetch` is always mocked, so no test in this file ever makes a
 * real network call.
 */
function createAdapter(config: Partial<FonnteConfig> = {}): FonnteVerificationMessagingAdapter {
  const fullConfig: FonnteConfig = {
    apiToken: 'fixture-test-token-not-real',
    apiUrl: 'https://api.fonnte.com/send',
    requestTimeoutMs: 5000,
    ...config,
  };
  const configService = { get: () => fullConfig } as unknown as ConfigService;
  return new FonnteVerificationMessagingAdapter(configService);
}

describe('FonnteVerificationMessagingAdapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('sends target, countryCode, and message - never omitting countryCode (Phase 2.23 regression: Fonnte defaults to Indonesia +62 without it)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = createAdapter();
    const phone = PhoneNumber.create('SY', '0936862035');

    const result = await adapter.sendVerificationCode(phone, '123456');

    expect(result).toEqual({ status: 'sent' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = init.body as URLSearchParams;
    expect(body.get('target')).toBe('963936862035');
    expect(body.get('countryCode')).toBe('963');
    expect(body.get('message')).toContain('123456');
  });

  it('derives countryCode from the same phone for a non-Syrian (UAE) number, never defaulting to 963 or 62', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = createAdapter();
    const phone = PhoneNumber.create('AE', '0501234567');

    await adapter.sendVerificationCode(phone, '654321');

    const [, init] = fetchMock.mock.calls[0];
    const body = init.body as URLSearchParams;
    expect(body.get('target')).toBe('971501234567');
    expect(body.get('countryCode')).toBe('971');
  });

  it('never sends the Authorization header value anywhere except the header itself', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: true }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = createAdapter({ apiToken: 'fixture-test-token-not-real' });
    const phone = PhoneNumber.create('SY', '0936862035');
    await adapter.sendVerificationCode(phone, '123456');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe('fixture-test-token-not-real');
    const body = init.body as URLSearchParams;
    expect(body.toString()).not.toContain('fixture-test-token-not-real');
  });

  it('returns failed when Fonnte reports status:false, without throwing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: false, reason: 'device disconnected' }),
    }) as unknown as typeof fetch;

    const adapter = createAdapter();
    const result = await adapter.sendVerificationCode(
      PhoneNumber.create('SY', '0936862035'),
      '123456',
    );

    expect(result).toEqual({ status: 'failed' });
  });

  it('returns failed on a non-2xx HTTP response', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;

    const adapter = createAdapter();
    const result = await adapter.sendVerificationCode(
      PhoneNumber.create('SY', '0936862035'),
      '123456',
    );

    expect(result).toEqual({ status: 'failed' });
  });

  it('returns failed (fails closed) when apiToken is not configured', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = createAdapter({ apiToken: '' });
    const result = await adapter.sendVerificationCode(
      PhoneNumber.create('SY', '0936862035'),
      '123456',
    );

    expect(result).toEqual({ status: 'failed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns failed on a network/timeout error, without throwing', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('network error')) as unknown as typeof fetch;

    const adapter = createAdapter();
    const result = await adapter.sendVerificationCode(
      PhoneNumber.create('SY', '0936862035'),
      '123456',
    );

    expect(result).toEqual({ status: 'failed' });
  });
});
