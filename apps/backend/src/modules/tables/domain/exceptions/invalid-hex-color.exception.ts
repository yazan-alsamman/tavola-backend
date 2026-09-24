import { DomainException } from '@shared/domain/base/domain-exception.base';

export class InvalidHexColorException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(raw: string) {
    super(`Invalid color "${raw}" - expected a hex color in the form #RRGGBB.`, 400);
  }
}
