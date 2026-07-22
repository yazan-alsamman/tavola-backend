import { InvalidPhoneNumberException, PhoneNumber } from './phone-number.vo';

describe('PhoneNumber value object (ADR-022)', () => {
  it('normalizes a Syria (+963) number to canonical E.164', () => {
    const phone = PhoneNumber.create('SY', '0912345678');
    expect(phone.value).toBe('+963912345678');
  });

  it('normalizes a UAE (+971) number to canonical E.164 without ever substituting +963', () => {
    const phone = PhoneNumber.create('AE', '0501234567');
    expect(phone.value.startsWith('+971')).toBe(true);
    expect(phone.value).not.toContain('963');
  });

  it('is case-insensitive on the country code', () => {
    const lower = PhoneNumber.create('sy', '0912345678');
    const upper = PhoneNumber.create('SY', '0912345678');
    expect(lower.value).toBe(upper.value);
  });

  it('resolves equivalent formatting of the same real number to the same canonical identity', () => {
    const withTrunkZero = PhoneNumber.create('SY', '0912345678');
    const withoutTrunkZero = PhoneNumber.create('SY', '912345678');
    expect(withTrunkZero.value).toBe(withoutTrunkZero.value);
  });

  it('rejects an invalid country/phone combination', () => {
    expect(() => PhoneNumber.create('SY', 'not-a-number')).toThrow(InvalidPhoneNumberException);
  });

  it('rejects an empty country code or phone number', () => {
    expect(() => PhoneNumber.create('', '0912345678')).toThrow(InvalidPhoneNumberException);
    expect(() => PhoneNumber.create('SY', '')).toThrow(InvalidPhoneNumberException);
  });

  it('rejects a malformed country code', () => {
    expect(() => PhoneNumber.create('963', '0912345678')).toThrow(InvalidPhoneNumberException);
  });

  it('produces the Fonnte target format without the leading +, leaving the canonical value untouched', () => {
    const phone = PhoneNumber.create('SY', '0912345678');
    expect(phone.toFonnteTarget()).toBe('963912345678');
    expect(phone.value).toBe('+963912345678');
  });

  it('fromCanonical reconstructs an already-valid E.164 value without re-deriving it', () => {
    const phone = PhoneNumber.fromCanonical('+963912345678');
    expect(phone.value).toBe('+963912345678');
  });

  it('fromCanonical rejects a value that is not already E.164', () => {
    expect(() => PhoneNumber.fromCanonical('0912345678')).toThrow(InvalidPhoneNumberException);
  });

  it('derives the correct calling code for Syria (+963)', () => {
    const phone = PhoneNumber.create('SY', '0912345678');
    expect(phone.callingCode()).toBe('963');
  });

  it('derives the correct calling code for UAE (+971), never defaulting to Syria', () => {
    const phone = PhoneNumber.create('AE', '0501234567');
    expect(phone.callingCode()).toBe('971');
  });

  it('derives the calling code from a value reconstructed via fromCanonical too', () => {
    const phone = PhoneNumber.fromCanonical('+971501234567');
    expect(phone.callingCode()).toBe('971');
  });
});
