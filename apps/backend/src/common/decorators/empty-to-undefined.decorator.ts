import { Transform } from 'class-transformer';

/**
 * Normalizes an omitted-but-present query parameter to `undefined`.
 *
 * `@IsOptional()` skips validation only for `undefined`/`null`. A query string
 * carries neither: `?status=` arrives as the empty string `''`, which
 * `@IsOptional()` does NOT skip, so a following `@IsIn([...])` rejects it with
 * a 400. That makes `?status=` behave differently from an omitted `status`,
 * and differently from `?q=` — which every list endpoint in this codebase
 * treats as "no filter" (API_GUIDELINES.md's search/filter semantics).
 *
 * A client that builds its query string from a form — sending every parameter
 * and leaving unselected ones blank — is the normal case, not an edge case,
 * so "present but blank" must mean the same thing as "absent". Applied above
 * `@IsOptional()` so the transform runs before validation.
 *
 * Whitespace-only is treated the same way, matching how the lookup readers
 * already trim `q` before deciding whether a text filter applies.
 */
export const EmptyStringToUndefined = (): PropertyDecorator =>
  Transform(({ value }) => {
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });
