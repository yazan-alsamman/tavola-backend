import { ConfigService } from '@nestjs/config';
import { PhoneNumber } from '@shared/domain/value-objects/phone-number.vo';
import { LightOtpConfig } from '@config/lightotp.config';
import { LightOtpVerificationMessagingAdapter } from './lightotp-verification-messaging.adapter';

/**
 * Never uses a real LightOTP API key - `apiKey` below is a fixture value
 * only, and `global.fetch` is always mocked, so no test in this file ever
 * makes a real network call.
 */
function createAdapter(config: Partial<LightOtpConfig> = {}): LightOtpVerificationMessagingAdapter {
  const fullConfig: LightOtpConfig = {
    apiKey: 'fixture-test-key-not-real',
    apiUrl: 'https://api.lightotp.com/SendMessage',
    requestTimeoutMs: 5000,
    ...config,
  };
  const configService = { get: () => fullConfig } as unknown as ConfigService;
  return new LightOtpVerificationMessagingAdapter(configService);
}

describe('LightOtpVerificationMessagingAdapter', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('POSTs to the LightOTP /SendMessage endpoint with the X-Api-Key header and JSON content type', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-1', messageStatus: 'Pending' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = createAdapter({ apiKey: 'fixture-test-key-not-real' });
    const phone = PhoneNumber.create('SY', '0936862035');

    const result = await adapter.sendVerificationCode(phone, '123456');

    expect(result).toEqual({ status: 'sent' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.lightotp.com/SendMessage');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Api-Key']).toBe('fixture-test-key-not-real');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sends toPhoneE164 with the leading + preserved, and otpCode as the raw code', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-1', messageStatus: 'Pending' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = createAdapter();
    const phone = PhoneNumber.create('SY', '0936862035');
    await adapter.sendVerificationCode(phone, '123456');

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.toPhoneE164).toBe('+963936862035');
    expect(body.otpCode).toBe('123456');
    expect(typeof body.idempotencyKey).toBe('string');
    expect(body.idempotencyKey).toHaveLength(36);
  });

  it('preserves a non-Syrian (UAE) number in full E.164, never substituting +963', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-1', messageStatus: 'Pending' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = createAdapter();
    const phone = PhoneNumber.create('AE', '0501234567');
    await adapter.sendVerificationCode(phone, '654321');

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.toPhoneE164).toBe('+971501234567');
  });

  it('never sends the X-Api-Key value anywhere except the header itself', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-1', messageStatus: 'Pending' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = createAdapter({ apiKey: 'fixture-test-key-not-real' });
    const phone = PhoneNumber.create('SY', '0936862035');
    await adapter.sendVerificationCode(phone, '123456');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-Api-Key']).toBe('fixture-test-key-not-real');
    expect(init.body as string).not.toContain('fixture-test-key-not-real');
  });

  it.each(['Pending', 'Sent', 'Delivered', 'Read'] as const)(
    'treats messageStatus %s as sent (the provider accepted the request)',
    async (messageStatus) => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'msg-1', messageStatus }),
      }) as unknown as typeof fetch;

      const adapter = createAdapter();
      const result = await adapter.sendVerificationCode(
        PhoneNumber.create('SY', '0936862035'),
        '123456',
      );

      expect(result).toEqual({ status: 'sent' });
    },
  );

  it.each(['Failed', 'Deleted'] as const)(
    'returns failed when LightOTP reports messageStatus %s, without throwing',
    async (messageStatus) => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'msg-1', messageStatus }),
      }) as unknown as typeof fetch;

      const adapter = createAdapter();
      const result = await adapter.sendVerificationCode(
        PhoneNumber.create('SY', '0936862035'),
        '123456',
      );

      expect(result).toEqual({ status: 'failed' });
    },
  );

  it('returns failed on a malformed response missing messageStatus', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'msg-1' }),
    }) as unknown as typeof fetch;

    const adapter = createAdapter();
    const result = await adapter.sendVerificationCode(
      PhoneNumber.create('SY', '0936862035'),
      '123456',
    );

    expect(result).toEqual({ status: 'failed' });
  });

  it('returns failed on a non-2xx HTTP response (e.g. 400 InvalidphoneNumber, 429 rate limit)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 400 }) as unknown as typeof fetch;

    const adapter = createAdapter();
    const result = await adapter.sendVerificationCode(
      PhoneNumber.create('SY', '0936862035'),
      '123456',
    );

    expect(result).toEqual({ status: 'failed' });
  });

  it('returns failed (fails closed) when apiKey is not configured, without calling fetch', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = createAdapter({ apiKey: '' });
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
