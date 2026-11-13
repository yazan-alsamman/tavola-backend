/**
 * ADR-052: a restaurant is named and described in Arabic, English or both.
 * `name`/`description` (read by app 1.0.2) carry the Arabic text, else the
 * English one. A caller that sends only the old single field keeps working:
 * its text is filed under the language of its script.
 */
export interface RestaurantTexts {
  name: string;
  nameAr: string | null;
  nameEn: string | null;
  description: string | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
}

export interface RestaurantTextsInput {
  name?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
  description?: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
}

const ARABIC_SCRIPT = /[؀-ۿ]/;

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

function resolvePair(
  legacy: string | null | undefined,
  ar: string | null | undefined,
  en: string | null | undefined,
): { value: string | null; ar: string | null; en: string | null } {
  let arText = blankToNull(ar);
  let enText = blankToNull(en);
  const legacyText = blankToNull(legacy);
  if (arText === null && enText === null && legacyText !== null) {
    if (ARABIC_SCRIPT.test(legacyText)) {
      arText = legacyText;
    } else {
      enText = legacyText;
    }
  }
  return { value: arText ?? enText, ar: arText, en: enText };
}

/** Returns null when no name is given in any form; the caller rejects that. */
export function resolveRestaurantTexts(input: RestaurantTextsInput): RestaurantTexts | null {
  const name = resolvePair(input.name, input.nameAr, input.nameEn);
  if (name.value === null) {
    return null;
  }
  const description = resolvePair(input.description, input.descriptionAr, input.descriptionEn);
  return {
    name: name.value,
    nameAr: name.ar,
    nameEn: name.en,
    description: description.value,
    descriptionAr: description.ar,
    descriptionEn: description.en,
  };
}
