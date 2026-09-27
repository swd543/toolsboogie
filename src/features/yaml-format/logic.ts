/**
 * YAML formatting + YAML → JSON logic (WASM core).
 */
import { CapabilityError, wasmYamlFormat, wasmYamlToJson } from '~/lib/wasm';

export interface YamlFormatResult {
  output: string;
}

/** Re-format a YAML document (validates). */
export async function yamlFormat(input: string): Promise<YamlFormatResult> {
  return { output: await wasmYamlFormat(input) };
}

/** Convert YAML to pretty JSON. */
export async function yamlToJson(input: string): Promise<YamlFormatResult> {
  return { output: await wasmYamlToJson(input) };
}

export function coreUnavailableMessage(e: unknown): string | null {
  if (e instanceof CapabilityError) {
    return 'The WASM core is missing in this build - run `pnpm wasm` and reload. (YAML processing needs the Rust core.)';
  }
  return null;
}
