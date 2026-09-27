/**
 * Regex checker/builder logic.
 *
 * Two honest responsibilities (documented in the UI):
 *
 *  1. **Execute** — live matches run on the ECMAScript engine (the only
 *     regex engine browsers give us). The flags UI exposes the standard
 *     g/i/m/s/u/y.
 *  2. **Lint** — a static flavor check. Each engine family (POSIX/GNU on
 *     Linux, Java, Go, Python, PCRE2/Perl/Ruby, .NET, Rust, ECMAScript)
 *     has a feature matrix; the linter scans the pattern for constructs
 *     the selected flavor doesn't support and says so before you paste it
 *     into a tool that will choke.
 *
 * A full multi-flavor regex engine is out of scope for a browser page —
 * the lint + ECMAScript execution combo is what makes the tool honest.
 */

/* ---------------- flavors ---------------- */

export type Flavor = 'js' | 'java' | 'go' | 'python' | 'pcre' | 'dotnet' | 'posix' | 'rust';

export interface FlavorInfo {
  id: Flavor;
  label: string;
  /** Where the engine lives (context for the user). */
  note: string;
}

export const FLAVORS: FlavorInfo[] = [
  { id: 'js', label: 'JavaScript / ECMAScript', note: 'RegExp in browsers and Node' },
  { id: 'java', label: 'Java', note: 'java.util.regex.Pattern' },
  { id: 'go', label: 'Go', note: 'github.com/... (RE2-based, linear time)' },
  { id: 'python', label: 'Python', note: 're module (backslash-escapes!)' },
  { id: 'pcre', label: 'PCRE2 / Perl / Ruby', note: 'grep -P, perl, ruby' },
  { id: 'dotnet', label: '.NET', note: 'System.Text.RegularExpressions' },
  { id: 'posix', label: 'POSIX ERE (Linux)', note: 'sed -E, awk, grep -E on Linux' },
  { id: 'rust', label: 'Rust', note: 'regex crate (RE2-based, linear time)' },
];

type Feature =
  | 'lookahead'
  | 'lookbehind'
  | 'backreference'
  | 'namedBackreference'
  | 'namedGroupPython'
  | 'unicodeClass'
  | 'posixClass'
  | 'shorthand'
  | 'nonGreedy'
  | 'inlineFlags'
  | 'conditional'
  | 'possessive'
  | 'setOperations'
  | 'wordBoundary';

const FEATURE_LABEL: Record<Feature, string> = {
  lookahead: 'lookahead `(?=…)` / `(?!…)`',
  lookbehind: 'lookbehind `(?<=…)` / `(?<!…)`',
  backreference: 'backreference `\\1`–`\\9`',
  namedBackreference: 'named backreference `\\k<name>` / `\\g<name>`',
  namedGroupPython: 'Python-style named group `(?P<name>…)`',
  unicodeClass: 'unicode property class `\\p{…}`',
  posixClass: 'POSIX class `[[:alpha:]]`',
  shorthand: 'shorthand classes `\\d \\w \\s`',
  nonGreedy: 'non-greedy quantifiers `*? +? ?? {n,m}?`',
  inlineFlags: 'inline flags `(?i)` `(?m)` …',
  conditional: 'conditional `(?(`…`yes|`no`…)`',
  possessive: 'possessive quantifiers `*+ ++ {n,m}+`',
  setOperations: 'character-class subtraction `[a-z--b-c]`',
  wordBoundary: 'word boundary `\\b`',
};

/**
 * The feature matrix. `true` = the flavor supports the construct.
 * Notes:
 *  - Go and Rust are RE2-based: no backreferences, no lookarounds,
 *    no backtracking — linear-time guarantee.
 *  - Python has no `\\p{}` and its lookbehinds must be bounded-width.
 *  - Java has no lookbehinds at all and no possessive quantifiers.
 *  - POSIX ERE is the minimal core: no backreferences, lookarounds,
 *    laziness, `\\d`, or `\\b` (\\b is a GNU extension, marked here as
 *    "not portable POSIX").
 */
const MATRIX: Record<Flavor, Record<Feature, boolean>> = {
  js: {
    lookahead: true,
    lookbehind: true,
    backreference: true,
    namedBackreference: true,
    namedGroupPython: false,
    unicodeClass: true,
    posixClass: false,
    shorthand: true,
    nonGreedy: true,
    inlineFlags: false,
    conditional: false,
    possessive: false,
    setOperations: false,
    wordBoundary: true,
  },
  java: {
    lookahead: true,
    lookbehind: false,
    backreference: true,
    namedBackreference: true,
    namedGroupPython: false,
    unicodeClass: true,
    posixClass: false,
    shorthand: true,
    nonGreedy: true,
    inlineFlags: true,
    conditional: true,
    possessive: false,
    setOperations: true,
    wordBoundary: true,
  },
  go: {
    lookahead: false,
    lookbehind: false,
    backreference: false,
    namedBackreference: false,
    namedGroupPython: false,
    unicodeClass: false,
    posixClass: false,
    shorthand: true,
    nonGreedy: true,
    inlineFlags: false,
    conditional: false,
    possessive: false,
    setOperations: false,
    wordBoundary: true,
  },
  python: {
    lookahead: true,
    lookbehind: true,
    backreference: true,
    namedBackreference: true,
    namedGroupPython: true,
    unicodeClass: false,
    posixClass: false,
    shorthand: true,
    nonGreedy: true,
    inlineFlags: true,
    conditional: false,
    possessive: false,
    setOperations: false,
    wordBoundary: true,
  },
  pcre: {
    lookahead: true,
    lookbehind: true,
    backreference: true,
    namedBackreference: true,
    namedGroupPython: true,
    unicodeClass: true,
    posixClass: true,
    shorthand: true,
    nonGreedy: true,
    inlineFlags: true,
    conditional: true,
    possessive: true,
    setOperations: true,
    wordBoundary: true,
  },
  dotnet: {
    lookahead: true,
    lookbehind: true,
    backreference: true,
    namedBackreference: true,
    namedGroupPython: false,
    unicodeClass: true,
    posixClass: false,
    shorthand: true,
    nonGreedy: true,
    inlineFlags: true,
    conditional: true,
    possessive: true,
    setOperations: true,
    wordBoundary: true,
  },
  posix: {
    lookahead: false,
    lookbehind: false,
    backreference: false,
    namedBackreference: false,
    namedGroupPython: false,
    unicodeClass: false,
    posixClass: true,
    shorthand: false,
    nonGreedy: false,
    inlineFlags: false,
    conditional: false,
    possessive: false,
    setOperations: false,
    wordBoundary: false,
  },
  rust: {
    lookahead: false,
    lookbehind: false,
    backreference: false,
    namedBackreference: false,
    namedGroupPython: false,
    unicodeClass: true,
    posixClass: false,
    shorthand: true,
    nonGreedy: true,
    inlineFlags: false,
    conditional: false,
    possessive: false,
    setOperations: false,
    wordBoundary: true,
  },
};

/* ---------------- pattern scanning ---------------- */

export interface LintWarning {
  feature: Feature;
  snippet: string;
  message: string;
}

/** Scan a pattern for the constructs it uses (position-agnostic). */
export function findFeatures(pattern: string): Partial<Record<Feature, string[]>> {
  const out: Partial<Record<Feature, string[]>> = {};
  const add = (feature: Feature, snippet: string) => {
    const list = out[feature];
    if (list) {
      list.push(snippet);
    } else {
      out[feature] = [snippet];
    }
  };

  // Lookarounds: (?=, (?! (lookahead); (?<=, (?<! (lookbehind).
  for (const m of pattern.matchAll(/\(\?[=!]|\(\?<[=!]/g)) {
    const s = m[0];
    if (s === '(?=' || s === '(?!') add('lookahead', s);
    else add('lookbehind', s);
  }
  for (const m of pattern.matchAll(/\\[1-9]\b/g)) add('backreference', m[0]);
  for (const m of pattern.matchAll(/\\[kg]<[A-Za-z_][A-Za-z0-9_]*>/g))
    add('namedBackreference', m[0]);
  if (/\(\?P</.test(pattern)) add('namedGroupPython', '(?P<name>…');
  for (const m of pattern.matchAll(/\\p\{[^}]*\}/g)) add('unicodeClass', m[0]);
  for (const m of pattern.matchAll(/\[\[:[a-z]+:\]\]/g)) add('posixClass', m[0]);
  for (const m of pattern.matchAll(/\\[dwsDiWsSUu]/g)) add('shorthand', m[0]);
  // Non-greedy: a quantifier immediately followed by '?' (*? +? ??).
  for (const m of pattern.matchAll(/[*+?]\?/g)) add('nonGreedy', m[0]);
  // Inline flags: (?i), (?im), (?i-m) — but not (?<name>, (?=, (?!…
  for (const m of pattern.matchAll(/\(\?[a-zA-Z]+(?:\/[a-zA-Z]+)*\)/g)) add('inlineFlags', m[0]);
  for (const m of pattern.matchAll(/\(\?\(/g)) add('conditional', m[0]);
  // Possessive: quantifier immediately followed by '+' (*+ ++ ?+ {n,m}+).
  for (const m of pattern.matchAll(/[*+?]\+|\{[^}]*\}\+/g)) add('possessive', m[0]);
  // Character-class subtraction: [a-z--b-c] (a '--' inside brackets that
  // is not a leading negated range).
  for (const m of pattern.matchAll(/\[[^\]]*--[^\]]*\]/g)) {
    const inner = m[0].slice(1, -1);
    if (!inner.startsWith('^--')) add('setOperations', m[0]);
  }
  for (const m of pattern.matchAll(/\\b/g)) add('wordBoundary', m[0]);
  return out;
}

/** Lint a pattern for a flavor: constructs the flavor doesn't support. */
export function lintFlavor(pattern: string, flavor: Flavor): LintWarning[] {
  const found = findFeatures(pattern);
  const warnings: LintWarning[] = [];
  for (const [feature, snippets] of Object.entries(found) as [Feature, string[]][]) {
    if (MATRIX[flavor][feature] === false) {
      warnings.push({
        feature,
        snippet: snippets[0] ?? '',
        message: `${FEATURE_LABEL[feature]} is not supported in ${FLAVORS.find((f) => f.id === flavor)?.label ?? flavor}.`,
      });
    }
  }
  return warnings;
}

/** All features a flavor supports (for the capability table). */
export function flavorFeatures(flavor: Flavor): Record<Feature, boolean> {
  return MATRIX[flavor];
}

/* ---------------- execution (ECMAScript engine) ---------------- */

export interface RegexFlags {
  g: boolean;
  i: boolean;
  m: boolean;
  s: boolean;
  u: boolean;
  y: boolean;
}

export const DEFAULT_FLAGS: RegexFlags = {
  g: true,
  i: false,
  m: false,
  s: false,
  u: true,
  y: false,
};

export function flagsString(f: RegexFlags): string {
  return (
    (f.g ? 'g' : '') +
    (f.i ? 'i' : '') +
    (f.m ? 'm' : '') +
    (f.s ? 's' : '') +
    (f.u ? 'u' : '') +
    (f.y ? 'y' : '')
  );
}

export interface MatchInfo {
  index: number;
  text: string;
  /** Capture groups (index 1..n); undefined when not captured. */
  groups: (string | undefined)[];
  /** Group names when the pattern uses named groups. */
  groupNames: string[];
}

export interface RegexRun {
  ok: boolean;
  /** Engine error when the pattern is invalid. */
  error?: string;
  matches: MatchInfo[];
  matchedCount: number;
  elapsedMs: number;
}

const MAX_MATCHES = 1000;

/** Run the pattern (ECMAScript) against text; returns matches + stats. */
export function runRegex(pattern: string, text: string, flags: RegexFlags): RegexRun {
  let re: RegExp;
  try {
    re = new RegExp(pattern, flagsString(flags));
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      matches: [],
      matchedCount: 0,
      elapsedMs: 0,
    };
  }
  const start = performance.now();
  const matches: MatchInfo[] = [];
  let matchedCount = 0;

  if (flags.g) {
    re.lastIndex = 0;
    let guard = 0;
    // Guard against zero-length match loops (the engine handles most, but
    // be defensive for pathological patterns).
    while (guard < MAX_MATCHES * 2) {
      guard += 1;
      const m = re.exec(text);
      if (!m) break;
      matchedCount += 1;
      if (matches.length < MAX_MATCHES) {
        matches.push({
          index: m.index,
          text: m[0],
          groups: m.slice(1),
          groupNames: (re as RegExp & { groups?: string[] }).groups ?? [],
        });
      }
      if (m[0].length === 0) {
        // Advance to escape zero-length loops.
        re.lastIndex += 1;
      }
    }
  } else {
    const m = re.exec(text);
    if (m) {
      matchedCount = 1;
      matches.push({
        index: m.index,
        text: m[0],
        groups: m.slice(1),
        groupNames: [],
      });
    }
  }
  return { ok: true, matches, matchedCount, elapsedMs: performance.now() - start };
}

/** Extract group names from the pattern (for the capture table). */
export function groupNames(pattern: string): string[] {
  const names: string[] = [];
  for (const m of pattern.matchAll(/\(\?<(?:P<)?([A-Za-z_][A-Za-z0-9_]*)>/g)) {
    names.push(m[1] ?? '');
  }
  return names;
}

/* ---------------- builder helpers ---------------- */

export interface TokenChip {
  label: string;
  insert: string;
  hint: string;
}

export const TOKEN_CHIPS: TokenChip[] = [
  { label: '^', insert: '^', hint: 'start of line (or string)' },
  { label: '$', insert: '$', hint: 'end of line (or string)' },
  { label: '\\b', insert: '\\b', hint: 'word boundary' },
  { label: '\\d', insert: '\\d', hint: 'digit' },
  { label: '\\w', insert: '\\w', hint: 'word character' },
  { label: '\\s', insert: '\\s', hint: 'whitespace' },
  { label: '.', insert: '.', hint: 'any character' },
  { label: '*', insert: '*', hint: '0 or more' },
  { label: '+', insert: '+', hint: '1 or more' },
  { label: '?', insert: '?', hint: '0 or 1' },
  { label: '{n,m}', insert: '{2,5}', hint: 'between n and m times' },
  { label: '[0-9a-f]', insert: '[0-9a-f]', hint: 'character class' },
  { label: '(…)', insert: '(…)', hint: 'capture group' },
  { label: '(?:…)', insert: '(?:…)', hint: 'non-capturing group' },
  { label: '(?=…)', insert: '(?=…)', hint: 'lookahead' },
];

export interface Example {
  label: string;
  pattern: string;
  test: string;
  note: string;
}

export const EXAMPLES: Example[] = [
  {
    label: 'Email (practical)',
    pattern: '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}',
    test: 'contact jane.doe+tag@example.co.uk and j@localhost',
    note: 'The practical email pattern - not the 200-line RFC one.',
  },
  {
    label: 'IPv4',
    pattern:
      '(?:(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)',
    test: 'server 192.168.1.1 is up, 300.1.2.3 is not',
    note: 'Each octet 0–255.',
  },
  {
    label: 'URL',
    pattern: 'https?:\\/\\/[\\w.-]+(?:\\/[\\w./%?&=+-]*)?',
    test: 'see https://example.com/path?a=1&b=2 and ftp://nope',
    note: 'http(s) URLs with a path.',
  },
  {
    label: 'Hex color',
    pattern: '#(?:[0-9a-f]{3}|[0-9a-f]{6})\\b',
    test: 'bg #fff, accent #c8451f, bad #12345',
    note: '3- or 6-digit hex.',
  },
  {
    label: 'Date (ISO)',
    pattern: '\\d{4}-\\d{2}-\\d{2}',
    test: 'created 2026-09-27, updated 25-09-2026',
    note: 'YYYY-MM-DD shape (not calendar validation).',
  },
  {
    label: 'UUID',
    pattern: '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    test: 'id 550e8400-e29b-41d4-a716-446655440000 done',
    note: 'RFC 4122 shape.',
  },
  {
    label: 'SemVer',
    pattern: '\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?',
    test: 'v1.2.3, 0.0.1-rc.1+build.5',
    note: 'Major.minor.patch with pre-release/build.',
  },
  {
    label: 'Phone (loose)',
    pattern: '(?:\\+\\d{1,3}[ \\-]?)?(?:\\d[ \\-]?){6,14}\\d',
    test: 'call +44 20 7946 0958 or 01234567890',
    note: 'Loose international shape - validate before you rely on it.',
  },
];

/** Escape regex metacharacters so text can be used as a literal pattern. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
