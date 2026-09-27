/**
 * Cron expression engine — pure TypeScript, no dependencies.
 *
 * Supported: standard 5-field cron (`min hour dom month dow`), 6-field
 * with a leading seconds field, and the common `@` aliases
 * (@yearly/@annually, @monthly, @weekly, @daily/@midnight, @hourly).
 *
 * Semantics follow the classic Vixie/cronie behaviour:
 *  - lists: `1,15,30`, ranges: `1-5`, steps: star-step and range-step forms
 *    `5/10` (means `5-max/10`, as in cronie)
 *  - names: `JAN-DEC` in the month field, `SUN-SAT` in the day-of-week
 *    field, case-insensitive
 *  - day-of-week 0 and 7 both mean Sunday
 *  - when BOTH day-of-month and day-of-week are restricted (not `*`),
 *    a time matches if EITHER matches (the classic union rule)
 *
 * `@reboot` is recognised and reported as non-time-based.
 */

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const DOW_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MONTH_ABBR: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const DOW_ABBR: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

export type FieldName = 'seconds' | 'minute' | 'hour' | 'dom' | 'month' | 'dow';

export interface FieldSpec {
  name: FieldName;
  raw: string;
  /** Sorted set of allowed values (cron values; dow 7 folded to 0). */
  values: number[];
  /** True when the raw field was `*` (unrestricted). */
  star: boolean;
  /** True when the field spans the full range (bare star, or star with a step). */
  full: boolean;
  /** Step value if a `/step` was used, else null. */
  step: number | null;
  min: number;
  max: number;
}

export interface ParsedCron {
  /** Original (trimmed) expression. */
  expr: string;
  /** True for a 6-field expression (leading seconds). */
  hasSeconds: boolean;
  seconds: FieldSpec | null;
  minute: FieldSpec;
  hour: FieldSpec;
  dom: FieldSpec;
  month: FieldSpec;
  dow: FieldSpec;
  /** Set when the expression was an @-alias. */
  alias: string | null;
  /** True for `@reboot` — a valid cron but not a clock schedule. */
  reboot: boolean;
}

export type CronParse =
  | { ok: true; parsed: ParsedCron }
  | { ok: false; expr: string; error: string };

const FIELD_BOUNDS: Record<
  FieldName,
  { min: number; max: number; names?: Record<string, number> }
> = {
  seconds: { min: 0, max: 59 },
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dom: { min: 1, max: 31 },
  month: { min: 1, max: 12, names: MONTH_ABBR },
  dow: { min: 0, max: 7, names: DOW_ABBR },
};

const FIELD_LABELS: Record<FieldName, string> = {
  seconds: 'seconds',
  minute: 'minute',
  hour: 'hour',
  dom: 'day-of-month',
  month: 'month',
  dow: 'day-of-week',
};

const ALIASES: Record<string, { expr: string; reboot?: boolean }> = {
  '@yearly': { expr: '0 0 1 1 *' },
  '@annually': { expr: '0 0 1 1 *' },
  '@monthly': { expr: '0 0 1 * *' },
  '@weekly': { expr: '0 0 * * 0' },
  '@daily': { expr: '0 0 * * *' },
  '@midnight': { expr: '0 0 * * *' },
  '@hourly': { expr: '0 * * * *' },
  '@reboot': { expr: '', reboot: true },
};

function fail(expr: string, error: string): CronParse {
  return { ok: false, expr, error };
}

/** Resolve a single value token (number or name) to a number. */
function resolveValue(token: string, field: FieldName): number | null {
  const bounds = FIELD_BOUNDS[field];
  const t = token.toLowerCase();
  if (/^\d+$/.test(token)) {
    const n = parseInt(token, 10);
    if (n < bounds.min || n > bounds.max) return null;
    return n;
  }
  const names = bounds.names;
  const named = names ? names[t] : undefined;
  if (named !== undefined) return named;
  return null;
}

function parseField(raw: string, name: FieldName): FieldSpec | null {
  const bounds = FIELD_BOUNDS[name];
  const star = raw === '*';
  const values = new Set<number>();
  let step: number | null = null;
  let full = true;

  for (const piece of raw.split(',')) {
    if (piece === '') return null; // trailing comma / empty list item

    let body = piece;
    let pieceStep: number | null = null;

    const slash = piece.indexOf('/');
    if (slash !== -1) {
      body = piece.slice(0, slash);
      const stepStr = piece.slice(slash + 1);
      if (!/^\d+$/.test(stepStr)) return null;
      pieceStep = parseInt(stepStr, 10);
      if (pieceStep < 1) return null; // */0 is invalid
    }

    let lo: number;
    let hi: number;

    if (body === '*') {
      lo = bounds.min;
      hi = bounds.max;
    } else {
      full = false;
      if (body.includes('-')) {
        const parts = body.split('-');
        if (parts.length !== 2) return null;
        const a = resolveValue(parts[0]!, name);
        const b = resolveValue(parts[1]!, name);
        if (a === null || b === null) return null;
        if (a > b) return null; // wrapping ranges (22-2) are not supported
        lo = a;
        hi = b;
      } else {
        const single = resolveValue(body, name);
        if (single === null) return null;
        lo = single;
        // `N/step` — cronie interprets a bare value with a step as N-max/step
        hi = slash !== -1 ? bounds.max : single;
      }
    }

    const s = pieceStep ?? 1;
    for (let v = lo; v <= hi; v += s) values.add(v);
    if (pieceStep !== null) step = pieceStep;
  }

  if (values.size === 0) return null;

  // Fold dow 7 -> 0 (both are Sunday).
  if (name === 'dow' && values.has(7)) {
    values.delete(7);
    values.add(0);
  }

  return {
    name,
    raw,
    values: [...values].sort((a, b) => a - b),
    star,
    full,
    step,
    min: bounds.min,
    max: bounds.max,
  };
}

export function parseCron(input: string): CronParse {
  const expr = input.trim();
  if (!expr) return fail(input, 'Empty expression.');

  if (expr.startsWith('@')) {
    const key = expr.toLowerCase();
    const alias = ALIASES[key];
    if (!alias) {
      return fail(
        expr,
        `Unknown @-alias “${expr}”. Supported: ${Object.keys(ALIASES).join(', ')}.`,
      );
    }
    if (alias.reboot) {
      return {
        ok: true,
        parsed: {
          expr,
          hasSeconds: false,
          seconds: null,
          minute: parseField('*', 'minute')!,
          hour: parseField('*', 'hour')!,
          dom: parseField('*', 'dom')!,
          month: parseField('*', 'month')!,
          dow: parseField('*', 'dow')!,
          alias: key,
          reboot: true,
        },
      };
    }
    // Expand the alias and parse it normally (one code path).
    const expanded = parseCron(alias.expr);
    if (!expanded.ok) return expanded;
    return { ok: true, parsed: { ...expanded.parsed, alias: key } };
  }

  const parts = expr.split(/\s+/);
  let hasSeconds = false;
  if (parts.length === 6 && parseField(parts[0]!, 'seconds')) {
    hasSeconds = true;
  }
  const fields = parts;
  if (fields.length === 7) {
    return fail(
      expr,
      'Seven-field (Quartz) expressions are not supported — use 5 fields, or 6 with a leading seconds field.',
    );
  }
  if (fields.length !== 5 && !(hasSeconds && fields.length === 6)) {
    return fail(
      expr,
      `Expected 5 fields (or 6 with a leading seconds field) — got ${fields.length}.`,
    );
  }

  const names: FieldName[] = hasSeconds
    ? ['seconds', 'minute', 'hour', 'dom', 'month', 'dow']
    : ['minute', 'hour', 'dom', 'month', 'dow'];

  const specs: FieldSpec[] = [];
  for (let i = 0; i < fields.length; i++) {
    const fname = names[i]!;
    const spec = parseField(fields[i]!, fname);
    if (!spec) return fail(expr, `Invalid ${FIELD_LABELS[fname]} field “${fields[i]}”.`);
    specs.push(spec);
  }

  return {
    ok: true,
    parsed: {
      expr,
      hasSeconds,
      seconds: hasSeconds ? specs[0]! : null,
      minute: specs[hasSeconds ? 1 : 0]!,
      hour: specs[hasSeconds ? 2 : 1]!,
      dom: specs[hasSeconds ? 3 : 2]!,
      month: specs[hasSeconds ? 4 : 3]!,
      dow: specs[hasSeconds ? 5 : 4]!,
      alias: null,
      reboot: false,
    },
  };
}

/* ---------------- matching + next runs ---------------- */

function inValues(spec: FieldSpec, value: number): boolean {
  return spec.values.includes(value);
}

/** Minute-level match (seconds excluded — used by the scanner). */
function minuteMatches(p: ParsedCron, d: Date): boolean {
  if (!inValues(p.minute, d.getMinutes())) return false;
  if (!inValues(p.hour, d.getHours())) return false;
  if (!inValues(p.month, d.getMonth() + 1)) return false;
  const domOk = inValues(p.dom, d.getDate());
  const dowOk = inValues(p.dow, d.getDay());
  // Classic union rule: both restricted -> OR; otherwise AND (a `*`
  // field always matches, so AND is safe there).
  if (!p.dom.star && !p.dow.star) return domOk || dowOk;
  return domOk && dowOk;
}

/** Does `date` match the schedule? (Wall-clock components of `date`.) */
export function matchesCron(p: ParsedCron, date: Date): boolean {
  if (p.reboot) return false;
  if (p.seconds && !inValues(p.seconds, date.getSeconds())) return false;
  return minuteMatches(p, date);
}

const SCAN_LIMIT = 4 * 366 * 24 * 60; // ~4 years of minutes (< 2.2M steps)

/**
 * Next `count` wall-clock instants strictly after `from` at which the
 * schedule fires, or `null` if it never matches (e.g. day 30 in February).
 * Iterates wall-clock minutes: JS Date arithmetic follows the local
 * timezone, so spring-forward times that don't exist are skipped and
 * fall-back times fire once — the same behaviour as system crons.
 */
export function nextRuns(p: ParsedCron, from: Date, count = 5): Date[] | null {
  if (p.reboot) return null;
  const out: Date[] = [];
  const fromMs = from.getTime();
  const cursor = new Date(from);
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1); // first boundary strictly after `from`

  for (let i = 0; i < SCAN_LIMIT; i++) {
    if (minuteMatches(p, cursor)) {
      if (p.seconds) {
        // First allowed second inside the matching minute.
        for (const s of p.seconds.values) {
          const t = new Date(cursor.getTime() + s * 1000);
          // Cursor is always a minute boundary after `from`, so every
          // second in it is strictly after `from` — but guard anyway.
          if (t.getTime() > fromMs) {
            out.push(t);
            break;
          }
        }
      } else {
        out.push(new Date(cursor.getTime()));
      }
      if (out.length === count) return out;
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return out.length > 0 ? out : null;
}

/* ---------------- human explanation ---------------- */

const fmt2 = (n: number) => String(n).padStart(2, '0');

const monthName = (m: number) => MONTH_NAMES[(m - 1) % 12];
const dowName = (d: number) => DOW_NAMES[d % 7];

function describeValues(values: number[], count: string): string {
  if (values.length === 1) return String(values[0]);
  if (values.length <= 4) return values.join(', ');
  return `${values[0]}–${values[values.length - 1]} (${count})`;
}

function dowList(values: number[]): string {
  const vs = [...values].sort((a, b) => a - b);
  if (vs.length === 7) return 'every day of the week';
  if (vs.length === 5 && vs.join() === '1,2,3,4,5') return 'weekdays (Mon–Fri)';
  if (vs.length === 2 && vs.join() === '0,6') return 'weekends (Sat–Sun)';
  return vs.map(dowName).join(', ');
}

/** Describes minute+hour together, or null when a generic fallback is better. */
function describeTimes(minute: FieldSpec, hour: FieldSpec): string | null {
  const exact =
    minute.step === null && hour.step === null && minute.values.length * hour.values.length <= 8;
  if (exact) {
    const times: string[] = [];
    for (const h of hour.values) {
      for (const m of minute.values) {
        times.push(`${fmt2(h)}:${fmt2(m)}`);
      }
    }
    return times.length === 1
      ? `at ${times[0]}`
      : `at ${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}`;
  }
  if (minute.full && minute.step !== null && hour.star) {
    return `every ${minute.step} minutes`;
  }
  if (minute.full && minute.step !== null) {
    return `every ${minute.step} minutes, during the hours ${describeValues(hour.values, 'listed')}`;
  }
  if (hour.full && hour.step !== null) {
    return `at minute 0, every ${hour.step} hours`;
  }
  return null;
}

/** One or two plain-English sentences describing the schedule. */
export function explainCron(p: ParsedCron): string {
  if (p.reboot) {
    return 'Runs once when the system (or cron daemon) boots — not a clock schedule, so there are no “next runs” to list.';
  }

  const bits: string[] = [];
  let freq = false;
  if (p.hasSeconds && p.seconds) {
    if (p.seconds.star) {
      bits.push('every second');
      freq = true;
    } else {
      bits.push(`at second ${describeValues(p.seconds.values, 'listed')} of each matching minute`);
    }
  }

  const times = describeTimes(p.minute, p.hour);
  if (times) {
    bits.push(times);
    if (times.startsWith('every ')) freq = true;
  } else if (!p.minute.star && p.hour.star) {
    bits.push(`at minutes ${describeValues(p.minute.values, 'listed')} of every hour`);
  } else if (p.minute.star && !p.hour.star) {
    bits.push(`at hour ${describeValues(p.hour.values, 'listed')}, minute 0`);
  } else {
    const minPart = p.minute.star ? '' : `minute ${describeValues(p.minute.values, 'listed')}`;
    const hrPart = p.hour.star ? 'every hour' : `hour ${describeValues(p.hour.values, 'listed')}`;
    bits.push(`${minPart ? minPart + ', ' : ''}${hrPart}`);
  }

  if (!p.month.star) {
    bits.push(
      p.month.values.length === 1
        ? `in ${monthName(p.month.values[0]!)}`
        : `in ${p.month.values.map(monthName).join(', ')}`,
    );
  }

  const domRestricted = !p.dom.star;
  const dowRestricted = !p.dow.star;
  if (domRestricted && dowRestricted) {
    bits.push(
      `on day ${describeValues(p.dom.values, 'listed')} of the month OR on ${dowList(p.dow.values)} (both fields restricted — standard cron fires when either matches)`,
    );
  } else if (domRestricted) {
    bits.push(`on day ${describeValues(p.dom.values, 'listed')} of each month`);
  } else if (dowRestricted) {
    bits.push(`on ${dowList(p.dow.values)}`);
  }

  let s = bits.join(' ');
  s = `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
  if (!freq && !domRestricted && !dowRestricted) s += ', every day';
  return `${s}.`;
}

/* ---------------- builder ---------------- */

export interface CronBuildOptions {
  mode: 'minute' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
  /** 'minute': every N minutes (1-59). */
  everyMinutes?: number;
  /** 'hourly': minute-of-hour to run at (0-59). */
  minuteOfHour?: number;
  /** 'daily' / 'weekly' / 'monthly' / 'yearly': time of day. */
  hour?: number;
  minute?: number;
  /** 'weekly': cron day-of-week values (0-6). */
  days?: number[];
  /** 'monthly' / 'yearly': day of month (1-31). */
  dayOfMonth?: number;
  /** 'yearly': month (1-12). */
  month?: number;
  /** 'custom': raw expression. */
  custom?: string;
}

/** Produce a canonical cron expression from builder options. */
export function buildCron(o: CronBuildOptions): string {
  switch (o.mode) {
    case 'minute':
      return `*/${clampInt(o.everyMinutes ?? 5, 1, 59)} * * * *`;
    case 'hourly':
      return `${clampInt(o.minuteOfHour ?? 0, 0, 59)} * * * *`;
    case 'daily':
      return `${clampInt(o.minute ?? 0, 0, 59)} ${clampInt(o.hour ?? 9, 0, 23)} * * *`;
    case 'weekly': {
      const days = (o.days && o.days.length > 0 ? o.days : [1])
        .map((d) => ((d % 7) + 7) % 7)
        .sort((a, b) => a - b);
      return `${clampInt(o.minute ?? 0, 0, 59)} ${clampInt(o.hour ?? 9, 0, 23)} * * ${days.join(',')}`;
    }
    case 'monthly':
      return `${clampInt(o.minute ?? 0, 0, 59)} ${clampInt(o.hour ?? 9, 0, 23)} ${clampInt(o.dayOfMonth ?? 1, 1, 31)} * *`;
    case 'yearly':
      return `${clampInt(o.minute ?? 0, 0, 59)} ${clampInt(o.hour ?? 9, 0, 23)} ${clampInt(o.dayOfMonth ?? 1, 1, 31)} ${clampInt(o.month ?? 1, 1, 12)} *`;
    case 'custom':
      return (o.custom ?? '').trim();
  }
}

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

/* ---------------- formatting helpers for the UI ---------------- */

export function formatNextRun(d: Date): string {
  const date = d.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

export function timeZoneName(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'local time';
    return tz.replace(/_/g, ' ');
  } catch {
    return 'local time';
  }
}

/** Per-field plain text for the breakdown table. */
export function fieldPlainText(p: ParsedCron): { field: string; raw: string; text: string }[] {
  const rows: { field: string; raw: string; text: string }[] = [];
  if (p.hasSeconds && p.seconds) {
    rows.push({
      field: 'Seconds',
      raw: p.seconds.raw,
      text: p.seconds.full
        ? p.seconds.step
          ? `every ${p.seconds.step}`
          : 'every second'
        : describeValues(p.seconds.values, 'listed'),
    });
  }
  rows.push({
    field: 'Minute',
    raw: p.minute.raw,
    text: p.minute.full
      ? p.minute.step
        ? `every ${p.minute.step}`
        : 'every minute'
      : describeValues(p.minute.values, 'listed'),
  });
  rows.push({
    field: 'Hour',
    raw: p.hour.raw,
    text: p.hour.full
      ? p.hour.step
        ? `every ${p.hour.step}`
        : 'every hour'
      : describeValues(p.hour.values, 'listed'),
  });
  rows.push({
    field: 'Day of month',
    raw: p.dom.raw,
    text: p.dom.star ? 'any day' : describeValues(p.dom.values, 'listed'),
  });
  rows.push({
    field: 'Month',
    raw: p.month.raw,
    text: p.month.star ? 'any month' : p.month.values.map(monthName).join(', '),
  });
  rows.push({
    field: 'Day of week',
    raw: p.dow.raw,
    text: p.dow.star ? 'any day' : dowList(p.dow.values),
  });
  return rows;
}
