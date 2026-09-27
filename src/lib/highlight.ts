/**
 * Tiny syntax highlighters for the code panels — deliberately small and
 * dependency-free (a highlight.js/shiki would add hundreds of KB to the
 * JSON/YAML routes for marginal value here).
 *
 * Both highlighters are pure string → HTML (caller escapes trust: the
 * input is highlighted and escaped in one pass, then rendered with
 * `innerHTML` inside the code panels only).
 */

/* ---------------- JSON ---------------- */

const JSON_TOKEN =
  /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/**
 * Highlight JSON text. Keys (strings followed by `:`) get `.tok-key`,
 * plain strings `.tok-str`, numbers `.tok-num`, literals `.tok-bool`/
 * `.tok-null`. Returns escaped HTML.
 */
export function highlightJson(source: string): string {
  const escaped = escapeHtml(source);
  // Work on the escaped text; the pattern above still matches because
  // escaping only touches < > & (not quotes/digits).
  return escaped.replace(JSON_TOKEN, (match) => {
    let cls: string;
    if (/^"/.test(match)) {
      cls = match.endsWith(':') ? 'tok-key' : 'tok-str';
    } else if (/^(true|false)$/.test(match)) {
      cls = 'tok-bool';
    } else if (match === 'null') {
      cls = 'tok-null';
    } else {
      cls = 'tok-num';
    }
    return `<span class="${cls}">${match}</span>`;
  });
}

/* ---------------- YAML (light) ---------------- */

/**
 * Minimal YAML highlighting: comments, keys (`key:`), plain/quoted
 * scalars, and list markers. Not a full YAML grammar — good enough to
 * make formatted output scannable.
 */
export function highlightYaml(source: string): string {
  const lines = escapeHtml(source).split('\n');
  return lines
    .map((line) => {
      // Full-line comment.
      if (/^\s*#/.test(line)) return `<span class="tok-comment">${line}</span>`;
      // Inline comment (naïve: first unquoted #).
      const hash = findCommentStart(line);
      const [code, comment] = hash >= 0 ? [line.slice(0, hash), line.slice(hash)] : [line, ''];
      const keyMatch = code.match(/^(\s*)(- )?("[^"]*"|'[^']*'|[^:#\s][^:]*)(:)(\s|$)/);
      if (keyMatch) {
        const [, indent, dash, key, colon] = keyMatch;
        return (
          `${indent}${dash ?? ''}` +
          `<span class="tok-key">${key}</span>${colon}` +
          code.slice(keyMatch[0].length) +
          (comment ? `<span class="tok-comment">${comment}</span>` : '')
        );
      }
      // List item scalar.
      const listMatch = code.match(/^(\s*- )(.*)$/);
      if (listMatch) {
        return `${listMatch[1]}${maybeString(listMatch[2] ?? '')}`;
      }
      return maybeString(code) + (comment ? `<span class="tok-comment">${comment}</span>` : '');
    })
    .join('\n');
}

/** Index of a comment start that is not inside quotes. -1 when none. */
function findCommentStart(line: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1] ?? ' ')))
      return i;
  }
  return -1;
}

/** Wrap a leading quoted/number value of a scalar in a token span. */
function maybeScalar(value: string): string {
  if (/^["']/.test(value)) return `<span class="tok-str">${value}</span>`;
  if (/^-?\d+(\.\d+)?$/.test(value)) return `<span class="tok-num">${value}</span>`;
  if (/^(true|false|null|~)$/.test(value)) return `<span class="tok-bool">${value}</span>`;
  return value;
}

function maybeString(value: string): string {
  return maybeScalar(value.trimStart());
}

/* ---------------- shared ---------------- */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
