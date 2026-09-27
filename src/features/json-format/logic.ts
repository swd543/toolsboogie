/**
 * JSON formatting logic.
 *
 * The fast path is the Rust/WASM core (serde_json, exact error positions,
 * insertion- or sorted-key order). When the core is unavailable (fresh
 * clone without `pnpm wasm`), a pure-JS fallback keeps the tool working —
 * with the caveat that the error position is approximate and key order
 * follows the engine.
 */
import { CapabilityError, wasmJsonFormat, wasmJsonMinify } from '~/lib/wasm';

export interface JsonFormatOptions {
  indent: number; // spaces; 0 = minified
  sortKeys: boolean;
}

export interface JsonFormatResult {
  output: string;
  /** True when the Rust core produced the output. */
  via: 'wasm' | 'js';
}

/** Pretty-print (or minify) JSON; throws with a positioned message on bad input. */
export async function formatJson(
  input: string,
  opts: JsonFormatOptions,
): Promise<JsonFormatResult> {
  try {
    if (opts.indent === 0) {
      return { output: await wasmJsonMinify(input), via: 'wasm' };
    }
    return { output: await wasmJsonFormat(input, opts.indent, opts.sortKeys), via: 'wasm' };
  } catch (e) {
    if (e instanceof CapabilityError) {
      // JS fallback: validate + re-serialize.
      const value = JSON.parse(stripBom(input));
      const out = sortKeysOpt(value, opts.sortKeys);
      return {
        output: opts.indent === 0 ? JSON.stringify(out) : JSON.stringify(out, null, opts.indent),
        via: 'js',
      };
    }
    throw e;
  }
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Recursively sort object keys (JS fallback path). */
function sortKeysOpt<T>(value: T, sort: boolean): T {
  if (!sort) return value;
  return sortValue(value) as T;
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortValue((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/** Validate JSON; returns a positioned error string or null when valid. */
export async function validateJson(
  input: string,
): Promise<{ error: string | null; via: 'wasm' | 'js' }> {
  try {
    await wasmJsonMinify(input);
    return { error: null, via: 'wasm' };
  } catch (e) {
    if (e instanceof CapabilityError) {
      try {
        JSON.parse(stripBom(input));
        return { error: null, via: 'js' };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err), via: 'js' };
      }
    }
    return { error: e instanceof Error ? e.message : String(e), via: 'wasm' };
  }
}
