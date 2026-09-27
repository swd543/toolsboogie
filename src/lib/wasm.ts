/**
 * Loader for the Rust/WASM core (`public/wasm/toolcore.js`, built by
 * `pnpm wasm` from `wasm/toolcore`).
 *
 * The module is a plain same-origin ESM asset (wasm-pack `web` target), so
 * we load it with a dynamic import of the base-prefixed URL — this keeps
 * the site fully functional even when the artifact is absent (fresh clones
 * without a Rust toolchain): the loader rejects with a CapabilityError and
 * the JSON/YAML tools fall back to their pure-JS path; the tuner (which
 * genuinely needs the core) shows a friendly error.
 */
import { CapabilityError } from './types';

export { CapabilityError };

export interface PitchReading {
  /** Detected frequency in Hz; 0 when no confident pitch. */
  freq: number;
  /** Nearest MIDI note number; -1 when no confident pitch. */
  midi: number;
  /** Cents deviation from the nearest note (−50…+50). */
  cents: number;
  /** Note name (e.g. "A4"); empty when no confident pitch. */
  note: string;
  /** Frame RMS (0..1). */
  rms: number;
  /** Log-spaced spectrum magnitudes, 0..1. */
  spectrum: Float32Array;
}

/** Shape of the wasm-bindgen `web`-target module (see wasm/toolcore). */
interface ToolcoreModule {
  jsonFormat(input: string, indent: number, sortKeys: boolean): string;
  jsonMinify(input: string): string;
  yamlFormat(input: string): string;
  yamlToJson(input: string): string;
  jsonToYaml(input: string): string;
  pitchDetect(samples: Float32Array, sampleRate: number): PitchResultHandle;
  default?: (input?: unknown) => Promise<void>;
}

interface PitchResultHandle {
  freq(): number;
  midi(): number;
  cents(): number;
  note(): string;
  rms(): number;
  spectrum(): Float32Array;
  free(): void;
}

let modulePromise: Promise<ToolcoreModule> | null = null;

function loadModule(): Promise<ToolcoreModule> {
  if (!modulePromise) {
    const url = `${import.meta.env.BASE_URL}wasm/toolcore.js`;
    modulePromise = import(/* @vite-ignore */ url)
      .then((mod: ToolcoreModule) => {
        const init = mod.default;
        if (init) return init().then(() => mod);
        return mod;
      })
      .catch(() => {
        modulePromise = null;
        throw new CapabilityError(
          'The WASM tool core is not available in this build (run "pnpm wasm" to build it).',
          'js-fallback',
        );
      });
  }
  return modulePromise;
}

/** WASM core available? (cheap; used for feature hints). */
export async function toolcoreAvailable(): Promise<boolean> {
  try {
    await loadModule();
    return true;
  } catch {
    return false;
  }
}

/* ---------------- JSON ---------------- */

export async function wasmJsonFormat(
  input: string,
  indent: number,
  sortKeys: boolean,
): Promise<string> {
  const mod = await loadModule();
  return mod.jsonFormat(input, indent, sortKeys);
}

export async function wasmJsonMinify(input: string): Promise<string> {
  const mod = await loadModule();
  return mod.jsonMinify(input);
}

/* ---------------- YAML ---------------- */

export async function wasmYamlFormat(input: string): Promise<string> {
  const mod = await loadModule();
  return mod.yamlFormat(input);
}

export async function wasmYamlToJson(input: string): Promise<string> {
  const mod = await loadModule();
  return mod.yamlToJson(input);
}

export async function wasmJsonToYaml(input: string): Promise<string> {
  const mod = await loadModule();
  return mod.jsonToYaml(input);
}

/* ---------------- Pitch ---------------- */

/**
 * Analyze one audio frame. The returned reading owns the wasm handle:
 * call `dispose()` once done (or let it be GC'd — the wasm-bindgen finalizer
 * frees it, but explicit is cheaper).
 */
export async function wasmPitchDetect(
  samples: Float32Array,
  sampleRate: number,
): Promise<PitchReading> {
  const mod = await loadModule();
  const handle = mod.pitchDetect(samples, sampleRate);
  const reading: PitchReading = {
    freq: handle.freq(),
    midi: handle.midi(),
    cents: handle.cents(),
    note: handle.note(),
    rms: handle.rms(),
    spectrum: handle.spectrum(),
  };
  handle.free();
  return reading;
}
