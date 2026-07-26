import { ConfigService } from '@nestjs/config';
import { OneSignalConfig } from '@config/onesignal.config';
import { OneSignalNotificationProvider } from './onesignal-notification.provider';

/**
 * Never uses a real OneSignal API key - `apiKey` below is a fixture value
 * only, and `global.fetch` is always mocked, so no test in this file ever
 * makes a real network call.
 */
function createProvider(config: Partial<OneSignalConfig> = {}): OneSignalNotificationProvider {
  const fullConfig: OneSignalConfig = {
    appId: 'fixture-app-id',
    apiKey: 'fixture-test-key-not-real',
    apiUrl: 'https://api.onesignal.com/notifications',
    requestTimeoutMs: 5000,
    identityVerificationPrivateKey: '',
    identityVerificationExpirySeconds: 3600,
    ...config,
  };
  const configService = { get: () => fullConfig } as unknown as ConfigService;
  return new OneSignalNotificationProvider(configService);
}

describe('OneSignalNotificationProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('POSTs to https://api.onesignal.com/notifications with Authorization: Key <apiKey>', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ id: 'onesignal-msg-1' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = createProvider();
    await provider.send({
      userId: 'user-1',
      title: 'Reservation confirmed',
      body: 'Your reservation has been confirmed.',
      data: { reservationId: 'res-1' },
      idempotencyKey: 'idem-1',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.onesignal.com/notifications');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Key fixture-test-key-not-real');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('targets the recipient via include_aliases.external_id = userId, never a DeviceSession id', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ id: 'onesignal-msg-1' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = createProvider();
    await provider.send({
      userId: 'user-42',
      title: 'Title',
      body: 'Body',
      data: null,
      idempotencyKey: 'idem-1',
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.include_aliases).toEqual({ external_id: ['user-42'] });
    expect(body.target_channel).toBe('push');
    expect(body.app_id).toBe('fixture-app-id');
    expect(body.headings).toEqual({ en: 'Title' });
    expect(body.contents).toEqual({ en: 'Body' });
  });

  it('returns accepted with the providerMessageId when OneSignal responds 200 with an id', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ id: 'onesignal-msg-abc' }),
    }) as unknown as typeof fetch;

    const provider = createProvider();
    const result = await provider.send({
      userId: 'user-1',
      title: 'T',
      body: 'B',
      data: null,
      idempotencyKey: 'idem-1',
    });

    expect(result).toEqual({ outcome: 'accepted', providerMessageId: 'onesignal-msg-abc' });
  });

  it('returns noRecipients on HTTP 200 with no id (OneSignal: no matching subscriptions)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const provider = createProvider();
    const result = await provider.send({
      userId: 'user-1',
      title: 'T',
      body: 'B',
      data: null,
      idempotencyKey: 'idem-1',
    });

    expect(result).toEqual({ outcome: 'noRecipients' });
  });

  it('returns retryableFailure with reason rate_limited on HTTP 429', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 429 }) as unknown as typeof fetch;

    const provider = createProvider();
    const result = await provider.send({
      userId: 'user-1',
      title: 'T',
      body: 'B',
      data: null,
      idempotencyKey: 'idem-1',
    });

    expect(result).toEqual({ outcome: 'retryableFailure', reason: 'rate_limited' });
  });

  it('returns retryableFailure on a 5xx server error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 503 }) as unknown as typeof fetch;

    const provider = createProvider();
    const result = await provider.send({
      userId: 'user-1',
      title: 'T',
      body: 'B',
      data: null,
      idempotencyKey: 'idem-1',
    });

    expect(result.outcome).toBe('retryableFailure');
  });

  it('returns permanentFailure on a non-429 4xx error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 400 }) as unknown as typeof fetch;

    const provider = createProvider();
    const result = await provider.send({
      userId: 'user-1',
      title: 'T',
      body: 'B',
      data: null,
      idempotencyKey: 'idem-1',
    });

    expect(result.outcome).toBe('permanentFailure');
  });

  it('returns permanentFailure (fails closed) when apiKey/appId are not configured, without calling fetch', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = createProvider({ apiKey: '', appId: '' });
    const result = await provider.send({
      userId: 'user-1',
      title: 'T',
      body: 'B',
      data: null,
      idempotencyKey: 'idem-1',
    });

    expect(result.outcome).toBe('permanentFailure');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns retryableFailure on a network/timeout error, without throwing', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('network error')) as unknown as typeof fetch;

    const provider = createProvider();
    const result = await provider.send({
      userId: 'user-1',
      title: 'T',
      body: 'B',
      data: null,
      idempotencyKey: 'idem-1',
    });

    expect(result.outcome).toBe('retryableFailure');
  });

  it('never sends the API key value anywhere except the Authorization header', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ id: 'm-1' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = createProvider({ apiKey: 'fixture-test-key-not-real' });
    await provider.send({
      userId: 'user-1',
      title: 'T',
      body: 'B',
      data: null,
      idempotencyKey: 'idem-1',
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body as string).not.toContain('fixture-test-key-not-real');
  });

  it('never forwards idempotencyKey to OneSignal (no documented request-level idempotency field)', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ id: 'm-1' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const provider = createProvider();
    await provider.send({
      userId: 'user-1',
      title: 'T',
      body: 'B',
      data: null,
      idempotencyKey: 'unique-idempotency-marker',
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body as string).not.toContain('unique-idempotency-marker');
  });
});
