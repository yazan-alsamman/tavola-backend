import { parseDurationToSeconds } from './auth.config';

describe('auth.config', () => {
  describe('parseDurationToSeconds', () => {
    it('parses seconds', () => {
      expect(parseDurationToSeconds('30s')).toBe(30);
    });

    it('parses minutes', () => {
      expect(parseDurationToSeconds('15m')).toBe(900);
    });

    it('parses hours', () => {
      expect(parseDurationToSeconds('2h')).toBe(7200);
    });

    it('parses days', () => {
      expect(parseDurationToSeconds('30d')).toBe(2_592_000);
    });

    it('rejects invalid formats', () => {
      expect(() => parseDurationToSeconds('15')).toThrow(/Invalid duration format/);
    });
  });
});
