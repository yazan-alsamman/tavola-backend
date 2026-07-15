import { ValueObject } from '../base/value-object.base';
import { DomainException } from '../base/domain-exception.base';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FINGERPRINT_LENGTH = 128;

export class InvalidDeviceFingerprintException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super('Device fingerprint must be a valid UUID or bounded string.', 400);
  }
}

export class DeviceFingerprint extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): DeviceFingerprint {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_FINGERPRINT_LENGTH) {
      throw new InvalidDeviceFingerprintException();
    }
    if (!UUID_REGEX.test(trimmed) && trimmed.length < 8) {
      throw new InvalidDeviceFingerprintException();
    }
    return new DeviceFingerprint(trimmed);
  }

  get value(): string {
    return this.props.value;
  }
}
