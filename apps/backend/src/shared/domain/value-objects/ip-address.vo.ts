import { ValueObject } from '../base/value-object.base';
import { DomainException } from '../base/domain-exception.base';

const IPV4_REGEX = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
const IPV6_REGEX = /^[0-9a-f:]+$/i;

export class InvalidIpAddressException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(value: string) {
    super(`Invalid IP address: ${value}`, 400);
  }
}

export class IPAddress extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): IPAddress {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new InvalidIpAddressException(raw);
    }
    const isV4 = IPV4_REGEX.test(trimmed);
    const isV6 = trimmed.includes(':') && IPV6_REGEX.test(trimmed);
    if (!isV4 && !isV6) {
      throw new InvalidIpAddressException(raw);
    }
    return new IPAddress(trimmed);
  }

  get value(): string {
    return this.props.value;
  }
}
