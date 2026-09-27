/**
 * JSON → YAML conversion logic (WASM core; no JS fallback — YAML
 * serialization is exactly what the core is for, and shipping a YAML
 * emitter in JS would double the page for a rare fallback).
 */
import { CapabilityError, wasmJsonToYaml } from '~/lib/wasm';

export interface ConvertResult {
  output: string;
}

export async function jsonToYaml(input: string): Promise<ConvertResult> {
  return { output: await wasmJsonToYaml(input) };
}

export function coreUnavailableMessage(e: unknown): string | null {
  if (e instanceof CapabilityError) {
    return 'The WASM core is missing in this build — run `pnpm wasm` and reload. (JSON→YAML needs the Rust core.)';
  }
  return null;
}
