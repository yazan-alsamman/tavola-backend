import type { Request } from 'express';
import { clientIpFromForwardedChain, resolveClientIp } from './resolve-client-ip.util';

function buildRequest(overrides: {
  forwardedFor?: string;
  ip?: string;
  remoteAddress?: string;
}): Request {
  return {
    headers:
      overrides.forwardedFor !== undefined ? { 'x-forwarded-for': overrides.forwardedFor } : {},
    ip: overrides.ip,
    socket: { remoteAddress: overrides.remoteAddress },
  } as unknown as Request;
}

describe('resolveClientIp (one trusted proxy, the production default)', () => {
  it('uses the address Nginx appended, not a client-supplied first hop', () => {
    // Client sent "X-Forwarded-For: 1.2.3.4"; Nginx appended the real peer.
    const request = buildRequest({
      forwardedFor: '1.2.3.4, 203.0.113.5',
      remoteAddress: '127.0.0.1',
    });
    expect(resolveClientIp(request)).toBe('203.0.113.5');
  });

  it('returns the real client when the client sent no X-Forwarded-For', () => {
    const request = buildRequest({ forwardedFor: '203.0.113.9', remoteAddress: '127.0.0.1' });
    expect(resolveClientIp(request)).toBe('203.0.113.9');
  });

  it('cannot be steered by rotating a spoofed header', () => {
    const first = buildRequest({
      forwardedFor: '9.9.9.1, 203.0.113.7',
      remoteAddress: '127.0.0.1',
    });
    const second = buildRequest({
      forwardedFor: '9.9.9.2, 203.0.113.7',
      remoteAddress: '127.0.0.1',
    });
    expect(resolveClientIp(first)).toBe(resolveClientIp(second));
  });

  it('falls back to the socket address on a direct request with no header', () => {
    const request = buildRequest({ remoteAddress: '::1' });
    expect(resolveClientIp(request)).toBe('::1');
  });

  it('falls back to request.ip when the socket address is missing', () => {
    const request = buildRequest({ ip: '127.0.0.1' });
    expect(resolveClientIp(request)).toBe('127.0.0.1');
  });

  it('returns "unknown" when nothing is available', () => {
    const request = buildRequest({ ip: '' });
    expect(resolveClientIp(request)).toBe('unknown');
  });
});

describe('clientIpFromForwardedChain', () => {
  it('skips as many entries from the right as there are trusted proxies', () => {
    expect(clientIpFromForwardedChain('1.1.1.1, 2.2.2.2, 10.0.0.2', '10.0.0.1', 2)).toBe('2.2.2.2');
  });

  it('trusts nothing in the header when there is no proxy', () => {
    expect(clientIpFromForwardedChain('1.1.1.1', '203.0.113.1', 0)).toBe('203.0.113.1');
  });

  it('accepts a repeated header delivered as an array', () => {
    expect(clientIpFromForwardedChain(['1.1.1.1', '203.0.113.2'], '127.0.0.1', 1)).toBe(
      '203.0.113.2',
    );
  });
});
