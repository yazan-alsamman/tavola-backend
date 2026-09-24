import { HexColor } from './hex-color.vo';
import { InvalidHexColorException } from '../exceptions/invalid-hex-color.exception';

describe('HexColor (ADR-040)', () => {
  it('normalizes to uppercase so two spellings of one color are the same value', () => {
    expect(HexColor.create('#14b8a6').value).toBe('#14B8A6');
    expect(HexColor.create('#14B8A6').value).toBe('#14B8A6');
    expect(HexColor.create('#14b8a6').equals(HexColor.create('#14B8A6'))).toBe(true);
  });

  it('trims surrounding whitespace', () => {
    expect(HexColor.create('  #F97316 ').value).toBe('#F97316');
  });

  it.each([
    ['shorthand', '#FFF'],
    ['alpha', '#14B8A6FF'],
    ['missing hash', '14B8A6'],
    ['non-hex digits', '#GGGGGG'],
    ['CSS color name', 'teal'],
    ['rgb() form', 'rgb(20, 184, 166)'],
    ['empty', ''],
  ])('rejects %s (%s) rather than coercing it', (_label, raw) => {
    expect(() => HexColor.create(raw)).toThrow(InvalidHexColorException);
  });

  it('reports the offending input as sent, not as normalized, so the error is recognizable', () => {
    expect(() => HexColor.create('#fff')).toThrow(/#fff/);
  });

  it('passes null straight through for the optional Table override', () => {
    expect(HexColor.createNullable(null)).toBeNull();
    expect(HexColor.createNullable('#f97316')?.value).toBe('#F97316');
  });

  it('still validates a non-null value passed to createNullable', () => {
    expect(() => HexColor.createNullable('#FFF')).toThrow(InvalidHexColorException);
  });
});
