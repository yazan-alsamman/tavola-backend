import { ValueObject } from '@shared/domain/base/value-object.base';
import { InvalidHexColorException } from '../exceptions/invalid-hex-color.exception';

/**
 * Exactly `#RRGGBB` - six hexadecimal digits behind a single `#`. Three-digit
 * shorthand (`#FFF`) and eight-digit alpha (`#RRGGBBAA`) are deliberately
 * rejected rather than expanded or truncated (ADR-040 decision #5): a single
 * canonical stored form means two colors are equal exactly when their stored
 * strings are equal, with no normalization rules for a future reader to
 * rediscover, and it keeps the column at a fixed `VarChar(7)`.
 */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * ADR-040 - the presentation color of a FloorPlanArea (required) or the
 * per-table override on a Table (optional). Input is accepted in either case
 * and normalized to uppercase, so `#14b8a6` and `#14B8A6` are the same value
 * and are stored identically.
 *
 * Presentation metadata only, exactly like `TableShape`: it never participates
 * in reservation rules, capacity, availability, or merge/split behavior.
 */
export class HexColor extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): HexColor {
    const normalized = raw.trim().toUpperCase();
    if (!HEX_COLOR_PATTERN.test(normalized)) {
      throw new InvalidHexColorException(raw);
    }
    return new HexColor(normalized);
  }

  /** `null` in, `null` out - for the nullable `Table.color` override. */
  static createNullable(raw: string | null): HexColor | null {
    return raw === null ? null : HexColor.create(raw);
  }

  get value(): string {
    return this.props.value;
  }
}
