import { applyDecorators } from '@nestjs/common';
import { Matches } from 'class-validator';
import { HEX_COLOR_PATTERN } from '../../domain/value-objects/hex-color.vo';

/**
 * ADR-040 - request-level guard for every color field (`FloorPlanArea.color`,
 * `Table.color`). Deliberately NOT class-validator's built-in `@IsHexColor()`,
 * which also accepts `#RGB`, `#RGBA` and `#RRGGBBAA`: the domain stores exactly
 * one canonical form, so accepting shapes the `HexColor` value object would
 * then reject would only move the same 400 one layer deeper with a vaguer
 * message. Reuses the value object's own pattern, so the two can never drift.
 */
export function IsHexColor6(): PropertyDecorator {
  return applyDecorators(
    Matches(HEX_COLOR_PATTERN, {
      message: '$property must be a hex color in the form #RRGGBB.',
    }),
  );
}
