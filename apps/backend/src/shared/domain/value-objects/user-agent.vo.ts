import { ValueObject } from '../base/value-object.base';
import { DomainException } from '../base/domain-exception.base';

const MAX_USER_AGENT_LENGTH = 512;

export class InvalidUserAgentException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super('User agent must be a non-empty string within length limits.', 400);
  }
}

export class UserAgent extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): UserAgent {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_USER_AGENT_LENGTH) {
      throw new InvalidUserAgentException();
    }
    return new UserAgent(trimmed);
  }

  get value(): string {
    return this.props.value;
  }
}
