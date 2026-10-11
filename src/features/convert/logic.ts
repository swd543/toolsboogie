/**
 * Data converter logic (Rust/WASM core).
 *
 * One converter for five formats - JSON, YAML, TOML, INI, XML - normalized
 * through a single value tree in the core, with per-target options
 * (indent, sort keys, YAML anchors, null policy). Nothing leaves the browser.
 */
import {
  CapabilityError,
  type DataConvertOptions,
  type DataFormat,
  type NullPolicy,
  wasmDataConvert,
  wasmDetectFormat,
  wasmValidateData,
} from '~/lib/wasm';

export interface FormatDef {
  id: DataFormat;
  /** Human label for selects and copy. */
  label: string;
  /** File extension for downloads (no dot). */
  ext: string;
  /** MIME type for downloads. */
  mime: string;
  /** One honest line about the format's limits (shown in the aside). */
  note: string;
  /** Search-friendly name for per-path titles ("JSON to YAML …"). */
  name: string;
}

export const FORMATS: FormatDef[] = [
  {
    id: 'json',
    label: 'JSON',
    ext: 'json',
    mime: 'application/json',
    name: 'JSON',
    note: 'Full fidelity: numbers, strings, booleans, nulls, arrays, any depth.',
  },
  {
    id: 'yaml',
    label: 'YAML',
    ext: 'yaml',
    mime: 'text/yaml',
    name: 'YAML',
    note: 'Anchors and merge keys are resolved on input; repeated blocks are deduplicated with anchors on output.',
  },
  {
    id: 'toml',
    label: 'TOML',
    ext: 'toml',
    mime: 'text/plain',
    name: 'TOML',
    note: 'One document, table-style. Has no null value - the null policy decides what happens.',
  },
  {
    id: 'ini',
    label: 'INI',
    ext: 'ini',
    mime: 'text/plain',
    name: 'INI',
    note: 'Flat: one level of [sections], key=value, values stored as text. Arrays and deeper nesting are rejected.',
  },
  {
    id: 'xml',
    label: 'XML',
    ext: 'xml',
    mime: 'text/xml',
    name: 'XML',
    note: 'xml2js-style convention: @-prefixed attributes, #text for mixed text, empty element = null. Needs a single root.',
  },
];

export const formatById = (id: string): FormatDef | undefined => FORMATS.find((f) => f.id === id);

export interface FormatPair {
  from: DataFormat;
  to: DataFormat;
  /** URL slug, e.g. "json-to-yaml". */
  slug: string;
}

export const slugFor = (from: DataFormat, to: DataFormat): string => `${from}-to-${to}`;

/** All 20 directed conversion paths (5 formats × 4 targets). */
export function formatPairs(): FormatPair[] {
  const out: FormatPair[] = [];
  for (const f of FORMATS) {
    for (const t of FORMATS) {
      if (f.id !== t.id) out.push({ from: f.id, to: t.id, slug: slugFor(f.id, t.id) });
    }
  }
  return out;
}

/** Parse a "json-to-yaml" slug; null when it is not a valid pair. */
export function parseSlug(slug: string): FormatPair | null {
  const m = /^([a-z]+)-to-([a-z]+)$/.exec(slug);
  if (!m) return null;
  const from = m[1] as DataFormat;
  const to = m[2] as DataFormat;
  if (!formatById(from) || !formatById(to) || from === to) return null;
  return { from, to, slug };
}

/**
 * Per-format samples that convert cleanly to every other format: flat
 * scalars plus one section, no arrays and no nulls (INI can't store
 * arrays, TOML/XML can't store null). Each path page prefills the input
 * in its own source format so the example matches the From select.
 */
export const SAMPLES: Record<DataFormat, string> = {
  json: `{
  "app": "boogie",
  "environment": "production",
  "debug": false,
  "port": 8080,
  "database": {
    "host": "localhost",
    "name": "boogie_db",
    "ssl": true
  }
}`,
  yaml: '',
  toml: '',
  ini: '',
  xml: '',
};

SAMPLES.yaml = `app: boogie
environment: production
debug: false
port: 8080
database:
  host: localhost
  name: boogie_db
  ssl: true`;

SAMPLES.toml = `app = "boogie"
environment = "production"
debug = false
port = 8080

[database]
host = "localhost"
name = "boogie_db"
ssl = true`;

SAMPLES.ini = `app=boogie
environment=production
debug=false
port=8080

[database]
host=localhost
name=boogie_db
ssl=true`;

SAMPLES.xml = `<config>
  <app>boogie</app>
  <environment>production</environment>
  <debug>false</debug>
  <port>8080</port>
  <database>
    <host>localhost</host>
    <name>boogie_db</name>
    <ssl>true</ssl>
  </database>
</config>`;

/** Back-compat name for the (default, JSON) sample. */
export const SAMPLE_INPUT = SAMPLES.json;

/** The input prefill for a source format ('auto' = the JSON sample). */
export function sampleFor(from: DataFormat | 'auto'): string {
  return from === 'auto' ? SAMPLES.json : SAMPLES[from];
}

export interface ConvertResult {
  output: string;
  /** The source format that was actually used (after auto-detect). */
  from: DataFormat;
  detected: boolean;
}

/**
 * Convert `input` from `from` to `to`. When `from` is the auto-sentinel
 * ("auto"), the core's format detection runs first; an empty detection
 * result falls back to `fallback` (default: json).
 */
export async function convert(
  input: string,
  from: DataFormat | 'auto',
  to: DataFormat,
  options: DataConvertOptions = {},
  fallback: DataFormat = 'json',
): Promise<ConvertResult> {
  let source: DataFormat;
  let detected = false;
  if (from === 'auto') {
    const guess = await wasmDetectFormat(input).catch(() => '');
    source = FORMATS.some((f) => f.id === guess) ? (guess as DataFormat) : fallback;
    detected = guess !== '' && source === guess;
  } else {
    source = from;
  }
  const output = await wasmDataConvert(input, source, to, options);
  return { output, from: source, detected };
}

/** Validate `input` as `format` without converting (live status). */
export async function validate(input: string, format: DataFormat): Promise<void> {
  // The core's parse-check: parses only, surfacing parser errors with positions.
  await wasmValidateData(input, format);
}

export interface ValidateResult {
  ok: boolean;
  /** The format that was checked (resolved from 'auto' when possible). */
  format: DataFormat | null;
  /** "object · 5 keys" when ok, the parse error message when not. */
  detail: string;
}

/**
 * Validate `input` as `from` ('auto' = detect first) and report the result
 * with a one-line structure summary. Never throws for parse problems -
 * those are returned as `{ ok: false }`; only core-unavailable errors throw.
 */
export async function validateSummary(
  input: string,
  from: DataFormat | 'auto',
): Promise<ValidateResult> {
  let src: DataFormat | null = from === 'auto' ? null : from;
  if (from === 'auto') {
    const guess = await wasmDetectFormat(input).catch(() => '');
    if (!FORMATS.some((f) => f.id === guess)) {
      return {
        ok: false,
        format: null,
        detail: 'Could not detect a format. Pick one in the From menu.',
      };
    }
    src = guess as DataFormat;
  }
  try {
    const summary = await wasmValidateData(input, src as DataFormat);
    return { ok: true, format: src, detail: summary };
  } catch (e) {
    return {
      ok: false,
      format: src,
      detail: coreUnavailableMessage(e) ?? (e instanceof Error ? e.message : String(e)),
    };
  }
}

export function coreUnavailableMessage(e: unknown): string | null {
  if (e instanceof CapabilityError) {
    return 'The WASM core is missing in this build - run `pnpm wasm` and reload. (The data converter needs the Rust core.)';
  }
  return null;
}

/** Per-path SEO text for the 20 /convert/<from>-to-<to> URLs. */
export function pathMeta(pair: FormatPair): { title: string; description: string } {
  const from = formatById(pair.from)!;
  const to = formatById(pair.to)!;
  return {
    title: `${from.name} to ${to.name} Converter - Free, Private, In-Browser | ToolsBoogie`,
    description:
      `Convert ${from.name} to ${to.name} right in your browser: paste ${from.name.toLowerCase()} ` +
      `and get clean ${to.name.toLowerCase()} - free, private, no upload, nothing leaves your device. ` +
      `Sort keys, control indentation, and choose how ${to.name.toLowerCase()}-specific limits are handled.`,
  };
}

/** The null-policy choices, with the user-facing blurb for each. */
export const NULL_POLICIES: { id: NullPolicy; label: string; hint: string }[] = [
  { id: 'fail', label: 'Fail (default)', hint: 'Report the exact key paths, convert nothing.' },
  { id: 'skip', label: 'Skip', hint: 'Drop the key (or array item) entirely.' },
  { id: 'emptyString', label: 'Empty string', hint: 'Write the key with an empty value.' },
];
