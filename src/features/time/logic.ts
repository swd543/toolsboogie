/**
 * Time/date converter logic.
 *
 * Input: any common representation (ISO 8601, RFC 2822, epoch in
 * seconds/ms/µs/ns, Windows FILETIME, .NET ticks, SQL datetime, C locale)
 * — explicit format pick, or auto-guess.
 *
 * Output: the same instant rendered for many ecosystems (human-readable
 * in a chosen IANA timezone, ISO/RFC, epoch in every unit, Python &
 * pandas literals, Linux `date` command + output, SQL, Windows FILETIME,
 * .NET ticks, Go, JavaScript).
 *
 * All math is integer-based where precision matters (µs/ns/FILETIME/ticks
 * via BigInt) so nothing rounds silently.
 */

export type InputFormat =
  | 'auto'
  | 'iso'
  | 'rfc2822'
  | 'epoch-s'
  | 'epoch-ms'
  | 'epoch-us'
  | 'epoch-ns'
  | 'filetime'
  | 'net-ticks'
  | 'sql'
  | 'c-locale';

export const INPUT_FORMATS: { id: InputFormat; label: string }[] = [
  { id: 'auto', label: 'Auto-detect' },
  { id: 'iso', label: 'ISO 8601 / RFC 3339' },
  { id: 'rfc2822', label: 'RFC 2822 (email date)' },
  { id: 'epoch-s', label: 'UNIX epoch seconds' },
  { id: 'epoch-ms', label: 'UNIX epoch milliseconds' },
  { id: 'epoch-us', label: 'UNIX epoch microseconds' },
  { id: 'epoch-ns', label: 'UNIX epoch nanoseconds' },
  { id: 'filetime', label: 'Windows FILETIME' },
  { id: 'net-ticks', label: '.NET Ticks' },
  { id: 'sql', label: 'SQL datetime (UTC)' },
  { id: 'c-locale', label: 'C locale (date output)' },
];

/** FILETIME/.NET anchor offset (1601-01-01 → 1970-01-01) in ms. */
const FILETIME_OFFSET_MS = 11644473600000;

export interface ParsedInstant {
  ms: number; // integer ms since epoch (UTC)
  /** Nanoseconds beyond the ms (0..999999) — only when the input had sub-ms precision. */
  subMs: number;
  /** How it was interpreted. */
  used: InputFormat;
  /** True when `auto` guessed (vs an explicit pick). */
  guessed: boolean;
}

export class TimeParseError extends Error {}

const isDigits = (s: string) => /^\d+$/.test(s);

/** Guess a numeric instant's unit from its digit count. */
export function guessEpochUnit(digits: number): 's' | 'ms' | 'us' | 'ns' {
  if (digits <= 10) return 's';
  if (digits <= 13) return 'ms';
  if (digits <= 16) return 'us';
  return 'ns';
}

export function parseInstant(input: string, format: InputFormat): ParsedInstant {
  const s = input.trim();
  if (!s) throw new TimeParseError('Empty input.');

  // Numeric instant.
  if (/^[+-]?\d+$/.test(s)) {
    const n = s.replace(/^[+-]/, '');
    const unit = format === 'auto' ? guessEpochUnit(n.length) : format.slice(6); // 'epoch-x' → 'x'
    if (format === 'filetime') {
      const v = BigInt(s);
      const ms = Number(v / 10000n - BigInt(FILETIME_OFFSET_MS));
      const subMs = Number((v % 10000n) * 100n);
      return { ms, subMs, used: 'filetime', guessed: false };
    }
    if (format === 'net-ticks') {
      // .NET ticks: 100-ns intervals since 0001-01-01.
      const v = BigInt(s);
      const ms = Number(v / 10000n - 62135596800000n);
      const subMs = Number((v % 10000n) * 100n);
      return { ms, subMs, used: 'net-ticks', guessed: false };
    }
    if (unit === 's') {
      if (!isDigits(n) || n.length > 11)
        throw new TimeParseError('Epoch seconds should be ≤ 11 digits.');
      return { ms: Number(n) * 1000, subMs: 0, used: 'epoch-s', guessed: format === 'auto' };
    }
    if (unit === 'ms') {
      if (n.length > 15) throw new TimeParseError('Epoch milliseconds should be ≤ 15 digits.');
      return { ms: Number(n), subMs: 0, used: 'epoch-ms', guessed: format === 'auto' };
    }
    // µs / ns: keep the exact value in BigInt for the remainder.
    const big = BigInt(s);
    if (unit === 'us') {
      const ms = Number(big / 1000n);
      const subMs = Number((big % 1000n) * 1000n);
      return { ms, subMs, used: 'epoch-us', guessed: format === 'auto' };
    }
    const ms = Number(big / 1000000n);
    const subMs = Number((big % 1000000n) / 1000n);
    return { ms, subMs, used: 'epoch-ns', guessed: format === 'auto' };
  }

  // Dated strings.
  const wantsRfc = format === 'rfc2822' || format === 'auto';
  const wantsIso = format === 'iso' || format === 'auto';
  const wantsSql = format === 'sql' || format === 'auto';

  const tryDate = (candidate: string, used: InputFormat): ParsedInstant | null => {
    // Force UTC when the string carries no zone info (SQL / plain ISO).
    const t = looksLikeUtcOnly(candidate) ? `${candidate}Z` : candidate;
    const ms = Date.parse(t);
    if (Number.isFinite(ms)) return { ms, subMs: 0, used, guessed: format === 'auto' };
    return null;
  };

  if (wantsIso && looksLikeIso(s)) {
    const r = tryDate(s, 'iso');
    if (r) return r;
  }
  if (wantsSql && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
    const r = tryDate(s.replace(' ', 'T'), 'sql');
    if (r) return r;
  }
  if (wantsRfc && looksLikeRfc2822(s)) {
    const r = tryDate(s, 'rfc2822');
    if (r) return r;
  }
  // Last resort: whatever the engine understands.
  if (format === 'auto' || format === 'c-locale') {
    const r = tryDate(s, 'c-locale');
    if (r) return r;
  }
  throw new TimeParseError(
    `Could not parse "${s}" as ${format === 'auto' ? 'any known format' : format}.`,
  );
}

function looksLikeIso(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s);
}

function looksLikeRfc2822(s: string): boolean {
  return /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}/.test(s);
}

function looksLikeUtcOnly(s: string): boolean {
  // A dated string without zone info — treat as UTC (documented in the UI).
  if (/(?:Z|[+-]\d{2}:?\d{2})\s*$/.test(s)) return false; // already zoned
  return looksLikeIso(s) || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s);
}

/* ---------------- formatting ---------------- */

export interface FormattedInstant {
  isoUtc: string;
  rfc3339: string;
  rfc2822: string;
  epochS: string;
  epochMs: string;
  epochUs: string;
  epochNs: string;
  filetime: string;
  netTicks: string;
  /** Human-readable in `tz`. */
  human: (tz: string | undefined) => string;
  humanDate: string;
  humanTime: string;
  offset: string; // e.g. "+02:00"
  pythonIso: string; // datetime.fromisoformat-ready (µs, UTC offset)
  pythonPandas: string; // Timestamp('…')
  linuxDateCmd: string;
  linuxDateOut: string; // `date -u` C-locale output
  sqlUtc: string; // 'YYYY-MM-DD HH:MM:SS'
  sqlPostgres: string; // 'YYYY-MM-DD HH:MM:SS.mmm+00'
  goLiteral: string;
  jsLiteral: string;
  dotnet: string;
  /** Underlying values for copy/download actions. */
  ms: number;
  subMs: number;
}

const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, '0');

export function formatInstant(p: ParsedInstant): FormattedInstant {
  const ms = p.ms;
  const d = new Date(ms);
  const frac = pad(p.subMs).slice(0, 3); // ms fraction (we keep µs precision via subMs)
  const isoUtc = d.toISOString();

  // Human-readable pieces in the *viewer's* default; the route re-renders
  // per selected timezone via `human(tz)`.
  const offMin = -d.getTimezoneOffset();
  const offset = `${offMin < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offMin) / 60))}:${pad(offMin % 60)}`;

  const epochS = String(Math.floor(ms / 1000));
  const epochMs = String(ms);
  const epochUs = String(BigInt(ms) * 1000n + BigInt(p.subMs));
  const epochNs = String(BigInt(ms) * 1000000n + BigInt(p.subMs) * 1000n);
  const filetime = String(BigInt(ms + FILETIME_OFFSET_MS) * 10000n + BigInt(p.subMs) / 100n);
  const netTicks = String(BigInt(ms + 62135596800000) * 10000n + BigInt(p.subMs) / 100n);

  return {
    isoUtc,
    rfc3339: isoUtc,
    rfc2822: rfc2822(d),
    epochS,
    epochMs,
    epochUs,
    epochNs,
    filetime,
    netTicks,
    human: (tz) => humanReadable(ms, tz),
    humanDate: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    humanTime: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
    offset,
    pythonIso: isoUtc.replace('Z', '+00:00'),
    pythonPandas: `Timestamp('${isoUtc}')`,
    linuxDateCmd: `date -u -d @${epochS}`,
    linuxDateOut: cLocaleUtc(d),
    sqlUtc: `${d.toISOString().slice(0, 19).replace('T', ' ')}`,
    sqlPostgres: `${d.toISOString().slice(0, 19).replace('T', ' ')}.${frac}+00`,
    goLiteral: `time.Unix(${epochS}, ${p.subMs * 1000}).UTC()`,
    jsLiteral: `new Date(${ms}) // ${isoUtc}`,
    dotnet: `new DateTimeOffset(${netTicks}, TimeSpan.Zero)`,
    ms,
    subMs: p.subMs,
  };
}

function rfc2822(d: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${days[d.getUTCDay()]}, ${pad(d.getUTCDate())} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`;
}

function cLocaleUtc(d: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${days[d.getUTCDay()]} ${months[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC ${d.getUTCFullYear()}`;
}

/** Human-readable in a timezone (Intl-based; undefined = viewer local). */
export function humanReadable(ms: number, tz: string | undefined): string {
  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  // en-GB emits "24" for midnight with hour12:false; normalize.
  const hour = get('hour') === '24' ? '00' : get('hour');
  const tzName = tz ? ` (${tz.replace(/_/g, ' ')})` : '';
  return `${get('weekday')}, ${get('day')} ${get('month')} ${get('year')} ${hour}:${get('minute')}:${get('second')}${tzName}`;
}

/** Timezones available to this runtime (Intl-backed, common subset sorted). */
export function availableTimezones(): string[] {
  let list: string[] | null = null;
  try {
    // Modern browsers + Node 20+: the IANA list from ICU itself.
    const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf;
    if (typeof sv === 'function') list = sv.call(Intl, 'timeZone');
  } catch {
    /* fall through to the static list */
  }
  if (!list || list.length === 0) list = [...COMMON_TIMEZONES];
  // ICU lists canonical ids (Etc/UTC, not UTC) — pin UTC at the top.
  if (!list.includes('UTC')) list = ['UTC', ...list];
  return list;
}

const COMMON_TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Zurich',
  'Europe/Warsaw',
  'Europe/Kiev',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Lagos',
  'Africa/Nairobi',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Perth',
  'Pacific/Auckland',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Phoenix',
];

/** Current-time ticker values (for the live display). */
export function nowParts(): { ms: number; epochS: string; epochMs: string } {
  const ms = Date.now();
  return { ms, epochS: String(Math.floor(ms / 1000)), epochMs: String(ms) };
}
