import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLAGS,
  EXAMPLES,
  escapeRegex,
  FLAVORS,
  findFeatures,
  groupNames,
  lintFlavor,
  runRegex,
} from './logic';

describe('runRegex', () => {
  it('finds global matches with groups', () => {
    const r = runRegex(
      '\\b(\\d{4})-(\\d{2})-(\\d{2})\\b',
      'x 2026-09-27 y 2020-01-01',
      DEFAULT_FLAGS,
    );
    expect(r.ok).toBe(true);
    expect(r.matchedCount).toBe(2);
    expect(r.matches[0]!.text).toBe('2026-09-27');
    expect(r.matches[0]!.groups).toEqual(['2026', '09', '27']);
  });

  it('single match without g', () => {
    const r = runRegex('\\d+', 'a1b22c333', { ...DEFAULT_FLAGS, g: false });
    expect(r.matchedCount).toBe(1);
    expect(r.matches[0]!.text).toBe('1');
  });

  it('reports engine errors', () => {
    const r = runRegex('(', 'x', DEFAULT_FLAGS);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('extracts named group names', () => {
    expect(groupNames('(?<year>\\d{4})-(?<month>\\d{2})')).toEqual(['year', 'month']);
  });

  it('handles zero-length matches safely', () => {
    const r = runRegex('x*', 'xx', DEFAULT_FLAGS);
    expect(r.ok).toBe(true);
    expect(r.matchedCount).toBeGreaterThanOrEqual(1);
  });
});

describe('flavor linting', () => {
  it('flags Go-incompatible constructs', () => {
    const warnings = lintFlavor('a(?=b)(?<=c)\\1\\k<n>\\p{L}', 'go');
    const features = new Set(warnings.map((w) => w.feature));
    expect(features).toContain('lookahead');
    expect(features).toContain('lookbehind');
    expect(features).toContain('backreference');
    expect(features).toContain('namedBackreference');
    expect(features).toContain('unicodeClass');
  });

  it('Python has no \\p but has (?P<name>)', () => {
    expect(lintFlavor('(?P<x>\\d+)', 'python')).toEqual([]);
    expect(lintFlavor('\\p{L}', 'python').map((w) => w.feature)).toContain('unicodeClass');
    expect(lintFlavor('(?P<x>\\d+)', 'java').map((w) => w.feature)).toContain('namedGroupPython');
  });

  it('POSIX ERE is the minimal flavor', () => {
    const w = lintFlavor('\\d+(?<=x)', 'posix').map((x) => x.feature);
    expect(w).toContain('shorthand');
    expect(w).toContain('lookbehind');
    expect(lintFlavor('[[:digit:]]+', 'posix')).toEqual([]);
    // POSIX class elsewhere:
    expect(lintFlavor('[[:alpha:]]', 'go').map((x) => x.feature)).toContain('posixClass');
  });

  it('PCRE is the maximal flavor', () => {
    const pattern = '(?<n>\\d+)\\k<n>(?=\\w)(?<=x)[[:digit:]]+*+(?i:x)';
    expect(
      lintFlavor(pattern, 'pcre').filter((w) => w.feature !== 'namedBackreference'),
    ).toHaveLength(0);
  });

  it('flags Java lookbehind + possessive', () => {
    const w = lintFlavor('(?<=a)b++', 'java').map((x) => x.feature);
    expect(w).toContain('lookbehind');
    expect(w).toContain('possessive');
  });

  it('Rust is RE2: no backrefs/lookaround, yes \\p', () => {
    expect(lintFlavor('\\p{Greek}', 'rust')).toEqual([]);
    expect(lintFlavor('a(\\1)', 'rust').map((w) => w.feature)).toContain('backreference');
  });
});

describe('findFeatures', () => {
  it('does not false-positive backrefs on octal-ish escapes', () => {
    const f = findFeatures('\\x1f(\\d)');
    expect(f.backreference).toBeUndefined();
    expect(f.unicodeClass).toBeUndefined();
  });
});

describe('builder helpers', () => {
  it('examples all run cleanly on the ECMAScript engine', () => {
    for (const ex of EXAMPLES) {
      const r = runRegex(ex.pattern, ex.test, DEFAULT_FLAGS);
      expect(r.ok, `example "${ex.label}" should compile`).toBe(true);
      expect(r.matchedCount, `example "${ex.label}" should match its test string`).toBeGreaterThan(
        0,
      );
    }
  });

  it('escapeRegex escapes metacharacters', () => {
    expect(escapeRegex('a.b*c(d)')).toBe('a\\.b\\*c\\(d\\)');
    const r = runRegex(escapeRegex('1+1=2'), 'x 1+1=2 y', DEFAULT_FLAGS);
    expect(r.matches[0]!.text).toBe('1+1=2');
  });

  it('lists the advertised flavors', () => {
    expect(FLAVORS.map((f) => f.id)).toEqual(
      expect.arrayContaining(['js', 'java', 'go', 'python', 'pcre', 'dotnet', 'posix', 'rust']),
    );
  });
});
