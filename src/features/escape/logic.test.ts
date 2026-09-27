import { describe, expect, it } from 'vitest';
import { VARIANTS, variant } from './logic';

const v = (id: string) => variant(id);

describe('JSON', () => {
  it('escapes quotes, backslashes, control chars, unicode', () => {
    expect(v('json').escape('a"b\\c\n')).toBe('"a\\"b\\\\c\\n"');
    expect(v('json').escape('héllo ✓')).toBe('"héllo ✓"');
  });

  it('round-trips', () => {
    const s = 'line1\n"quoted" \\ path\tend ✓';
    expect(v('json').unescape(v('json').escape(s))).toBe(s);
  });

  it('rejects unquoted input', () => {
    expect(() => v('json').unescape('nope')).toThrow();
  });
});

describe('JavaScript / Java / C / Python / Rust', () => {
  it('JS: escapes and keeps UTF-8 raw', () => {
    expect(v('js').escape('a\nb\tc"')).toBe('"a\\nb\\tc\\""');
    expect(v('js').escape('✓')).toBe('"✓"');
  });

  it('JS: round-trips (single-quoted too)', () => {
    const s = "it's a \\ test";
    expect(v('js').unescape(v('js').escape(s))).toBe(s);
    expect(v('js').unescape("'a\\'b'")).toBe("a'b");
  });

  it('Java: control chars as \\uXXXX', () => {
    const out = v('java').escape('a\vb');
    expect(out).toBe('"a\\u000bb"');
    expect(v('java').unescape('"a\\u0041b"')).toBe('aAb');
  });

  it('C: \\xHH for anonymous control chars', () => {
    const out = v('c').escape('a\x1bb');
    expect(out).toBe('"a\\x1bb"');
    expect(v('c').unescape('"a\\x1bb"')).toBe('a\x1bb');
  });

  it('Python: quote choice + escapes', () => {
    expect(v('python').escape('plain')).toBe("'plain'");
    expect(v('python').escape("has ' quote")).toBe('"has \' quote"');
    expect(v('python').unescape("'a\\nb'")).toBe('a\nb');
    expect(v('python').unescape('"""tri\\nple"""')).toBe('tri\nple');
  });
});

describe('HTML', () => {
  it('escapes the five dangerous characters', () => {
    expect(v('html').escape('<a href="x\'y">&</a>')).toBe(
      '&lt;a href=&quot;x&#39;y&quot;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('round-trips named + numeric entities', () => {
    const s = 'a < b & c "d" e';
    expect(v('html').unescape(v('html').escape(s))).toBe(s);
    expect(v('html').unescape('&#72;&#x69; &amp; &lt;')).toBe('Hi & <');
    // Unknown entity stays intact.
    expect(v('html').unescape('&unknown;')).toBe('&unknown;');
  });
});

describe('URL', () => {
  it('component vs path encoding', () => {
    expect(v('url-component').escape('a b&c/d?e=f')).toBe('a%20b%26c%2Fd%3Fe%3Df');
    expect(v('url-path').escape('https://ex.com/a b?c=d#f')).toBe('https://ex.com/a%20b?c=d#f');
    expect(v('url-component').unescape(v('url-component').escape('x y & z'))).toBe('x y & z');
  });
});

describe('Unicode', () => {
  it('escapes quotes, backslash and non-ASCII as \\uXXXX', () => {
    const out = v('unicode').escape('a"\\é');
    expect(out).toBe('a\\u0022\\u005c\\u00e9');
    expect(v('unicode').unescape(out)).toBe('a"\\é');
  });

  it('keeps safe ASCII raw', () => {
    const out = v('unicode').escape('plain');
    expect(out).toBe('plain');
  });

  it('escapes astral planes as surrogate pairs', () => {
    const out = v('unicode').escape('𝄞'); // U+1D11E
    expect(out).toBe('\\ud834\\udd1e');
    expect(v('unicode').unescape(out)).toBe('𝄞');
  });

  it('round-trips mixed content', () => {
    const s = 'mix "q" \\ ünïcode ✓ 𝟝';
    expect(v('unicode').unescape(v('unicode').escape(s))).toBe(s);
  });
});

describe('Shell / SQL', () => {
  it('shell single-quoting', () => {
    expect(v('shell').escape("it's")).toBe("'it'\\''s'");
    expect(v('shell').unescape(v('shell').escape("it's & <x>"))).toBe("it's & <x>");
  });

  it('sql quote doubling', () => {
    expect(v('sql').escape("O'Neil")).toBe("'O''Neil'");
    expect(v('sql').unescape("'O''Neil'")).toBe("O'Neil");
  });
});

describe('registry', () => {
  it('has the advertised variants', () => {
    expect(VARIANTS.map((x) => x.id)).toEqual(
      expect.arrayContaining([
        'json',
        'js',
        'java',
        'c',
        'python',
        'rust',
        'html',
        'url-component',
        'url-path',
        'unicode',
        'shell',
        'sql',
      ]),
    );
  });

  it('throws on unknown variant', () => {
    expect(() => variant('nope')).toThrow();
  });
});
