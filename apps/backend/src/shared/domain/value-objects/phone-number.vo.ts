import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { ValueObject } from '../base/value-object.base';
import { DomainException } from '../base/domain-exception.base';

export class InvalidPhoneNumberException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(countryCode: string, phoneNumber: string) {
    super(`Invalid phone number for country "${countryCode}": ${phoneNumber}`, 400);
  }
}

const E164_REGEX = /^\+[1-9]\d{6,14}$/;

/**
 * ADR-022 Decisions #13/#14 (DECISIONS.md, AUTHENTICATION_ARCHITECTURE.md
 * §15.10): canonical E.164, produced by validating the mobile Country Code
 * Picker's selected ISO 3166-1 alpha-2 country (the picker defaults its UI
 * to "SY"/Syria - never assumed here, only ever what the caller supplies)
 * against the entered national/local number, via the ADR-022-approved
 * `libphonenumber-js` library. The backend never trusts a client-assembled
 * E.164 string directly for a fresh submission - `create()` always
 * re-derives canonical E.164 from the two separate inputs. `fromCanonical`
 * exists only to reconstruct an already-validated value read back from
 * persistence, not to accept new client input.
 */
export class PhoneNumber extends ValueObject<{ value: string }> {
  private constructor(e164: string) {
    super({ value: e164 });
  }

  static create(countryCode: string, phoneNumber: string): PhoneNumber {
    const normalizedCountryCode = countryCode?.trim().toUpperCase();
    const normalizedNumber = phoneNumber?.trim();

    if (!normalizedCountryCode || !normalizedNumber) {
      throw new InvalidPhoneNumberException(countryCode, phoneNumber);
    }

    let parsed;
    try {
      parsed = parsePhoneNumberFromString(normalizedNumber, normalizedCountryCode as CountryCode);
    } catch {
      throw new InvalidPhoneNumberException(countryCode, phoneNumber);
    }

    if (!parsed || !parsed.isValid()) {
      throw new InvalidPhoneNumberException(countryCode, phoneNumber);
    }

    return new PhoneNumber(parsed.number);
  }

  /** Reconstructs an already-canonical E.164 value read from persistence - never used for fresh client input. */
  static fromCanonical(e164: string): PhoneNumber {
    if (!E164_REGEX.test(e164)) {
      throw new InvalidPhoneNumberException('', e164);
    }
    return new PhoneNumber(e164);
  }

  get value(): string {
    return this.props.value;
  }

  /**
   * Fonnte's documented target format has no leading "+" (AUTHENTICATION_ARCHITECTURE.md
   * §15.8) - a boundary-only conversion for the provider adapter; the
   * canonical stored/compared value always keeps the "+".
   */
  toFonnteTarget(): string {
    return this.props.value.replace(/^\+/, '');
  }

  toString(): string {
    return this.props.value;
  }
}
