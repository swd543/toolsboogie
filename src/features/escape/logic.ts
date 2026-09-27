/**
 * String escape/un-escape logic.
 *
 * Each variant is a small, documented transform (no regexes where a scan
 * is clearer). The UI offers the variants in two directions:
 *  - **Escape**: raw text → a form safe for a given context.
 *  - **Unescape**: an escaped string → raw text.
 *
 * Honest scope notes: shell escaping produces *single-quoted* form (the
 * portable idiom), SQL uses standard quote-doubling, and "JS/Java/Python"
 * cover the common escape sets rather than every language corner case.
 */

export interface EscapeVariant {
  id: string;
  label: string;
  /** Escape: raw → escaped. */
  escape: (s: string) => string;
  /** Unescape: escaped → raw; throws on invalid input. */
  unescape: (s: string) => string;
  note: string;
}

const CONTROL_ESCAPES: Record<string, string> = {
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\v': '\\v',
  '\f': '\\f',
  '\r': '\\r',
};

function hex2(ch: string): string {
  return ch.charCodeAt(0).toString(16).padStart(2, '0');
}

/** Common control-character escape for C-ish languages (beyond the named ones). */
function controlEscape(c: string): string {
  const named = CONTROL_ESCAPES[c];
  if (named) return named;
  if (c.charCodeAt(0) < 0x20) return `\\x${hex2(c)}`;
  return c;
}

/** Scan-escape: backslash-escape \ and ", plus named/common control chars. */
function clikeEscape(s: string, extra: Record<string, string> = {}): string {
  let out = '';
  for (const c of s) {
    if (c === '\\') out += '\\\\';
    else if (c === '"') out += '\\"';
    else {
      const named = CONTROL_ESCAPES[c] ?? extra[c];
      if (named) out += named;
      else if (c.charCodeAt(0) < 0x20) out += `\\x${hex2(c)}`;
      else out += c;
    }
  }
  return out;
}

/** Parse one escape sequence at position i in s (returns [value, next]). */
function readEscape(s: string, i: number): [string, number] {
  const c = s[i + 1];
  if (!c) throw new Error(`Dangling backslash at offset ${i}`);
  switch (c) {
    case 'n':
      return ['\n', i + 2];
    case 't':
      return ['\t', i + 2];
    case 'r':
      return ['\r', i + 2];
    case 'b':
      return ['\b', i + 2];
    case 'f':
      return ['\f', i + 2];
    case 'v':
      return ['\v', i + 2];
    case 'a':
      return ['\x07', i + 2];
    case '"':
      return ['"', i + 2];
    case "'":
      return ["'", i + 2];
    case '\\':
      return ['\\', i + 2];
    case '0': {
      // \0 (only bare \0; octal \NNN handled by callers)
      const nxt = s[i + 2];
      if (nxt !== undefined && nxt >= '0' && nxt <= '9') {
        // octal: \NNN
        const oct = s.slice(i + 2, i + 5).match(/^([0-7]{1,2})/);
        const digits = oct?.[1] ?? '';
        if (digits) return [String.fromCharCode(parseInt(digits, 8)), i + 2 + digits.length];
      }
      return ['\0', i + 2];
    }
    case 'x': {
      const m = s.slice(i + 2).match(/^([0-9a-fA-F]{1,2})/);
      const hx = m?.[1] ?? '';
      if (!hx) throw new Error(`Bad \\x escape at offset ${i}`);
      return [String.fromCharCode(parseInt(hx, 16)), i + 2 + hx.length];
    }
    case 'u': {
      const m = s.slice(i + 2).match(/^([0-9a-fA-F]{4})/);
      const hx = m?.[1] ?? '';
      if (!hx) throw new Error(`Bad \\u escape at offset ${i}`);
      return [String.fromCharCode(parseInt(hx, 16)), i + 6];
    }
    default:
      // Language-dependent; keep the backslash + char as-is (conservative).
      return [`\\${c}`, i + 2];
  }
}

/** Generic backslash-unescape (JS/Java/Python core set). */
function backslashUnescape(s: string, extra: Record<string, string> = {}): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i]!;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const nk = s[i + 1];
    const named = nk === undefined ? undefined : extra[nk];
    if (named !== undefined) {
      out += named;
      i += 1;
      continue;
    }
    const [value, next] = readEscape(s, i);
    out += value;
    i = next - 1;
  }
  return out;
}

/* ---------------- HTML ---------------- */

const HTML_NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  copy: '©',
  reg: '®',
  laquo: '«',
  raquo: '»',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  middot: '·',
  deg: '°',
  times: '×',
  divide: '÷',
  plusmn: '±',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function unescapeHtml(s: string): string {
  return s.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z]+));/g, (_, hex, dec, name) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (dec) return String.fromCodePoint(parseInt(dec, 10));
    return HTML_NAMED[name.toLowerCase()] ?? `&${name};`;
  });
}

/* ---------------- Python repr-ish ---------------- */

function pythonEscape(s: string): string {
  let inner = '';
  for (const c of s) {
    if (c === '\\') inner += '\\\\';
    else if (c === '\n') inner += '\\n';
    else if (c === '\t') inner += '\\t';
    else if (c === '\r') inner += '\\r';
    else {
      const named = CONTROL_ESCAPES[c];
      inner += named ?? c;
    }
  }
  // Prefer single quotes unless the content has single (and no double).
  if (inner.includes("'") && !inner.includes('"')) return `"${inner}"`;
  return `'${inner.replace(/'/g, "\\'")}'`;
}

/* ---------------- variants ---------------- */

export const VARIANTS: EscapeVariant[] = [
  {
    id: 'json',
    label: 'JSON',
    note: 'Safe inside a JSON string literal (double-quoted form).',
    escape: (s) => JSON.stringify(s),
    unescape: (s) => {
      const t = s.trim();
      if (!t.startsWith('"')) throw new Error('Expected a double-quoted JSON string.');
      return JSON.parse(t) as string;
    },
  },
  {
    id: 'js',
    label: 'JavaScript',
    note: 'String literal escapes (keeps UTF-8 characters raw).',
    escape: (s) => {
      let out = '';
      for (const c of s) {
        if (c === '\\') out += '\\\\';
        else if (c === '"') out += '\\"';
        else if (c === '\n') out += '\\n';
        else if (c === '\t') out += '\\t';
        else if (c === '\r') out += '\\r';
        else if (c === '`') out += '\\`';
        else if (c.charCodeAt(0) < 0x20) out += controlEscape(c);
        else out += c;
      }
      return `"${out}"`;
    },
    unescape: (s) => {
      let t = s.trim();
      if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) t = t.slice(1, -1);
      else if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) t = t.slice(1, -1);
      else if (t.startsWith('`') && t.endsWith('`') && t.length >= 2) t = t.slice(1, -1);
      return backslashUnescape(t);
    },
  },
  {
    id: 'java',
    label: 'Java',
    note: 'Java string literal (\\n \\t \\uXXXX; keeps UTF-8 raw).',
    escape: (s) => {
      let out = '';
      for (const c of s) {
        if (c === '\\') out += '\\\\';
        else if (c === '"') out += '\\"';
        else if (c === '\n') out += '\\n';
        else if (c === '\t') out += '\\t';
        else if (c === '\r') out += '\\r';
        else if (c.charCodeAt(0) < 0x20)
          out += `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
        else out += c;
      }
      return `"${out}"`;
    },
    unescape: (s) => backslashUnescape(stripJavaQuotes(s)),
  },
  {
    id: 'c',
    label: 'C / C++',
    note: 'C string literal (\\xHH for anonymous control characters).',
    escape: (s) => `"${clikeEscape(s)}"`,
    unescape: (s) => backslashUnescape(stripCQuotes(s)),
  },
  {
    id: 'python',
    label: 'Python',
    note: 'Python 3 string literal (repr-ish, quotes chosen for content).',
    escape: pythonEscape,
    unescape: (s) => backslashUnescape(stripPyQuotes(s)),
  },
  {
    id: 'rust',
    label: 'Rust',
    note: 'Rust C-style string literal (UTF-8, \\n etc.).',
    escape: (s) => `"${clikeEscape(s)}"`,
    unescape: (s) => backslashUnescape(stripCQuotes(s)),
  },
  {
    id: 'html',
    label: 'HTML entities',
    note: 'Entity escaping for HTML attribute/text context.',
    escape: escapeHtml,
    unescape: unescapeHtml,
  },
  {
    id: 'url-component',
    label: 'URL component',
    note: 'encodeURIComponent — for a query value or path segment.',
    escape: (s) => encodeURIComponent(s),
    unescape: (s) => decodeURIComponent(s),
  },
  {
    id: 'url-path',
    label: 'URL path',
    note: 'encodeURI — keeps the URL structure characters intact.',
    escape: (s) => encodeURI(s),
    unescape: (s) => decodeURI(s),
  },
  {
    id: 'unicode',
    label: 'Unicode \\uXXXX',
    note: 'Every non-ASCII (and unsafe ASCII) character as \\uXXXX.',
    escape: (s) => {
      let out = '';
      for (const c of s) {
        const code = c.codePointAt(0)!;
        if (code < 0x20 || code === 0x22 || code === 0x5c || code > 0x7e) {
          if (code <= 0xffff) out += `\\u${code.toString(16).padStart(4, '0')}`;
          else {
            const u = code - 0x10000;
            out += `\\u${(0xd800 + (u >> 10)).toString(16).padStart(4, '0')}`;
            out += `\\u${(0xdc00 + (u & 0x3ff)).toString(16).padStart(4, '0')}`;
          }
        } else out += c;
      }
      return out;
    },
    unescape: (s) => backslashUnescape(s),
  },
  {
    id: 'shell',
    label: 'Shell (single-quoted)',
    note: "POSIX shell idiom: wrap in single quotes, escape embedded ' as '\\'.'",
    escape: (s) => `'${s.replace(/'/g, `'\\''`)}'`,
    unescape: (s) => {
      let t = s.trim();
      if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
        // Embedded quotes were spliced in as '\'' — splice them back out.
        t = t.slice(1, -1).replace(/'\\''/g, "'");
      }
      return t;
    },
  },
  {
    id: 'sql',
    label: 'SQL (ANSI quoting)',
    note: "ANSI SQL: single-quoted literal with ' doubled.",
    escape: (s) => `'${s.replace(/'/g, "''")}'`,
    unescape: (s) => {
      let t = s.trim();
      if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) t = t.slice(1, -1);
      return t.replace(/''/g, "'");
    },
  },
];

export function variant(id: string): EscapeVariant {
  const v = VARIANTS.find((x) => x.id === id);
  if (!v) throw new Error(`Unknown escape variant: ${id}`);
  return v;
}

/* ---------------- quote stripping helpers ---------------- */

function stripCQuotes(s: string): string {
  let t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) t = t.slice(1, -1);
  return t;
}

function stripJavaQuotes(s: string): string {
  let t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) t = t.slice(1, -1);
  // Java also has \uXXXX processed lexically — our unescape handles it.
  return t;
}

function stripPyQuotes(s: string): string {
  let t = s.trim();
  // Triple-quoted strings.
  if (
    (t.startsWith("'''") && t.endsWith("'''") && t.length >= 6) ||
    (t.startsWith('"""') && t.endsWith('"""') && t.length >= 6)
  ) {
    t = t.slice(3, -3);
    return t;
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) t = t.slice(1, -1);
  else if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) t = t.slice(1, -1);
  return t;
}
