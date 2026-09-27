/**
 * Server entry: renders the app inside our document template.
 * Used by the dev server and by Nitro prerendering at build time.
 *
 * `nonce` stamps every inline script solid-start emits (the hydration
 * bootstrap, hydration task scripts, the client entry) with a CSP nonce so
 * the strict `script-src 'self' 'nonce-…'` policy in document.tsx lets them
 * run. The same value is defined at build time (vite.config.ts) and baked
 * into the prerendered CSP meta — see the comment there.
 */
import { createHandler, StartServer } from '@solidjs/start/server';
import { Document } from '~/document';

declare global {
  interface ImportMetaEnv {
    /** Build-time CSP nonce (base64) — see vite.config.ts. */
    SSR_NONCE: string;
  }
}

export default createHandler(() => <StartServer document={Document} />, {
  nonce: import.meta.env.SSR_NONCE,
});
