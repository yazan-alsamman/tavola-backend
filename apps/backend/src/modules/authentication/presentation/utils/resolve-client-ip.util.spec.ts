import type { Request } from 'express';
import { resolveClientIp } from './resolve-client-ip.util';

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

describe('resolveClientIp', () => {
  it('prefers the first hop of X-Forwarded-For when present', () => {
    const request = buildRequest({ forwardedFor: '203.0.113.5, 10.0.0.1', ip: '10.0.0.1' });
    expect(resolveClientIp(request)).toBe('203.0.113.5');
  });

  it('trims whitespace around the first forwarded hop', () => {
    const request = buildRequest({ forwardedFor: '  203.0.113.9  ,10.0.0.1' });
    expect(resolveClientIp(request)).toBe('203.0.113.9');
  });

  it('falls back to request.ip when no X-Forwarded-For header is present', () => {
    const request = buildRequest({ ip: '127.0.0.1' });
    expect(resolveClientIp(request)).toBe('127.0.0.1');
  });

  it('falls back to the socket remote address when request.ip is empty', () => {
    const request = buildRequest({ ip: '', remoteAddress: '::1' });
    expect(resolveClientIp(request)).toBe('::1');
  });

  it('returns "unknown" when nothing is available', () => {
    const request = buildRequest({ ip: '' });
    expect(resolveClientIp(request)).toBe('unknown');
  });

  it('treats an empty X-Forwarded-For header as absent', () => {
    const request = buildRequest({ forwardedFor: '', ip: '127.0.0.1' });
    expect(resolveClientIp(request)).toBe('127.0.0.1');
  });

  it('returns "unknown" when the first forwarded hop is itself empty', () => {
    const request = buildRequest({ forwardedFor: ',203.0.113.5' });
    expect(resolveClientIp(request)).toBe('unknown');
  });
});
