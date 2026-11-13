/**
 * A short device label such as "Chrome on Windows" from a User-Agent header,
 * for sessions whose client sent no `deviceName` (the web dashboard did not
 * before 2026-11-13, so every session read the same). Null when nothing is
 * recognised; never the raw header.
 */
export function describeUserAgent(userAgent: string | null | undefined): string | null {
  const { browser, operatingSystem } = parseUserAgent(userAgent);
  if (browser && operatingSystem) {
    return `${browser} on ${operatingSystem}`;
  }
  return browser ?? operatingSystem;
}

/** Product names only (Chrome, Windows...), so a client can word the label in its own language. */
export function parseUserAgent(userAgent: string | null | undefined): {
  browser: string | null;
  operatingSystem: string | null;
} {
  if (!userAgent) {
    return { browser: null, operatingSystem: null };
  }
  return {
    browser: matchFirst(userAgent, BROWSERS),
    operatingSystem: matchFirst(userAgent, SYSTEMS),
  };
}

type Rule = [RegExp, string];

// Order matters: Edge and Opera also carry "Chrome", Chrome also carries "Safari".
const BROWSERS: Rule[] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
  [/Dart\//, 'Tavola'],
];

const SYSTEMS: Rule[] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'Mac'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

function matchFirst(value: string, rules: Rule[]): string | null {
  for (const [pattern, label] of rules) {
    if (pattern.test(value)) {
      return label;
    }
  }
  return null;
}
