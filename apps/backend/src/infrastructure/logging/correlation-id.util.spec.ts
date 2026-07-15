import { resolveCorrelationId } from './correlation-id.util';

describe('resolveCorrelationId', () => {
  it('returns a safe client-supplied correlation ID', () => {
    expect(resolveCorrelationId('abc-123_request')).toBe('abc-123_request');
  });

  it('rejects unsafe values and generates a new ID', () => {
    const generated = resolveCorrelationId('<script>alert(1)</script>');

    expect(generated).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('rejects overly long unsafe values and generates a new ID', () => {
    const longValue = `${'<script>'.repeat(40)}`;

    expect(resolveCorrelationId(longValue)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
