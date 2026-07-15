import { ValueObject } from './value-object.base';

export interface EntityProps {
  id: string;
}

/**
 * Base entity with identity-based equality.
 */
export abstract class Entity<T extends EntityProps> extends ValueObject<T> {
  get id(): string {
    return this.props.id;
  }

  equals(other?: Entity<T>): boolean {
    if (other === undefined || other === null) {
      return false;
    }
    if (other.constructor !== this.constructor) {
      return false;
    }
    return this.id === other.id;
  }
}
