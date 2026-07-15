/**
 * Base for immutable domain value objects.
 * Equality is structural via {@link ValueObject.equals}.
 */
export abstract class ValueObject<T extends object> {
  protected readonly props: Readonly<T>;

  protected constructor(props: T) {
    this.props = Object.freeze({ ...props });
  }

  equals(other?: ValueObject<T>): boolean {
    if (other === undefined || other === null) {
      return false;
    }
    if (other.constructor !== this.constructor) {
      return false;
    }
    return ValueObject.shallowEqual(this.props, other.props);
  }

  private static shallowEqual(a: object, b: object): boolean {
    const keysA = Object.keys(a) as Array<keyof typeof a>;
    const keysB = Object.keys(b) as Array<keyof typeof b>;
    if (keysA.length !== keysB.length) {
      return false;
    }
    return keysA.every((key) => a[key] === b[key]);
  }
}
