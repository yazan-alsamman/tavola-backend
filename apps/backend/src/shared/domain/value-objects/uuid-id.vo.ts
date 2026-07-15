import { ValueObject } from '../base/value-object.base';

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InvalidUuidException extends Error {
  constructor(value: string) {
    super(`Invalid UUID: ${value}`);
    this.name = 'InvalidUuidException';
  }
}

export abstract class UuidId extends ValueObject<{ value: string }> {
  protected constructor(value: string, label: string) {
    const normalized = value.trim().toLowerCase();
    if (!UUID_V4_REGEX.test(normalized)) {
      throw new InvalidUuidException(`${label}: ${value}`);
    }
    super({ value: normalized });
  }

  get value(): string {
    return this.props.value;
  }

  toString(): string {
    return this.props.value;
  }
}
