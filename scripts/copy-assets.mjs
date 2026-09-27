/**
 * Pre-build asset copy (idempotent).
 *
 * Copies the Rust/WASM core build (`wasm/toolcore/pkg`) into `public/wasm`
 * so the static host serves it from the site root. Runs as `predev` and
 * `prebuild`. Safe to run repeatedly — a missing pkg/ just gets skipped
 * (the app degrades gracefully: the JSON/YAML tools fall back to JS, the
 * tuner needs the core and says so).
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const pub = join(root, 'public');

function copyIfSource(src, dest, label) {
  if (!existsSync(src)) {
    console.warn(`[copy-assets] skipping ${label} (source not found: ${src})`);
    return;
  }
  mkdirSync(pub, { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`[copy-assets] ${label} → ${join(pub, dest.split('/').join('/'))}`);
}

// Rust/WASM core (built via `pnpm wasm`).
copyIfSource(join(root, 'wasm', 'toolcore', 'pkg'), join(pub, 'wasm'), 'wasm toolcore');
