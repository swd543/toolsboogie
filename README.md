# ToolsBoogie

Free, secure and private browser tools — everything runs 100% client-side,
right in your browser. Nothing is ever uploaded: there is no backend to
upload to. No account, no analytics, no cookies.

## Tools

- **Guitar tuner** — microphone pitch detection (YIN, in a Rust/WASM core)
  with a cent-accurate needle, note history, and the six standard strings as
  one-tap targets. Web Audio API + AudioWorklet; SIMD in the FFT.
- **JSON formatter** — pretty-print / minify with key sorting and syntax
  highlighting. Fast path runs in Rust/WASM (`serde_json`), with a pure-JS
  fallback.
- **JSON → YAML** — convert with indentation, line-width and quote-style
  options (WASM core, `serde_yaml`-style emitter).
- **YAML formatter** — validate and re-emit YAML cleanly (WASM core).
- **JWT decode / encode / modify** — decode any JWT (header + claims with
  exp/iat/nbf status), edit claims and re-sign with HS256/384/512,
  RS256/384/512, or ES256/384/512 via WebCrypto (PEM or JWK keys). Signing
  keys never leave the browser.
- **Regex checker & builder** — live matching with matched text, capture
  groups and group names, plus a per-engine feature lint (JavaScript,
  PCRE, POSIX, Python, Go/RE2, Java, .NET, Rust flavors) so you can see
  what your pattern uses and which engines support it.
- **String escaper / unescaper** — escape or unescape strings for JSON, JS,
  Java, C/C++, Python, Rust, HTML, URL components, Unicode, shell, and SQL
  contexts, with live round-trip preview.
- **Date & time converter** — paste an instant in any common format (ISO
  8601, RFC 2822, epoch s/ms/µs/ns, Windows FILETIME, .NET ticks, SQL,
  C-locale) or tick from "now", pick any IANA timezone, and get every
  representation at once — epoch (s/ms/µs/ns), ISO 8601, RFC 2822,
  Unix/Windows FILETIME, .NET ticks, Go, Python, and JS — with copy buttons.
- **Cron builder & explainer** — explain cron expressions in plain English
  (per-field breakdown + next five fire times in your timezone) and build
  them back from options; 5-field, 6-field (seconds) and `@`-alias support
  with classic Vixie/cronie semantics (pure TypeScript).
- **Compass** — device orientation / WebGeolocation heading with a
  WebGPU-rendered dial (Canvas2D fallback), 16-wind labels and a
  calibration offset.
- **Measuring stick (ruler)** — a literal dual-edge on-screen ruler:
  metric (cm) on the left edge, imperial (inches) on the right. It
  calibrates itself from your screen's pixel density (96 × DPR estimate,
  flagged as such) or takes your display's real size / PPI for exactness,
  and measures any distance by click-drag.
- **Level** — a bubble level built on device tilt, with a WebGPU-rendered
  bubble (Canvas2D fallback), degree readout and a "level" indicator.

## Why in the browser?

- **Private.** Your data — files, tokens, keystrokes, the contents of your
  clipboard — never leaves the machine. There is no server to send it to.
- **Fast.** No round-trip; the result appears as you type.
- **Free.** No API keys, no rate limits, no "pro" tier.
- **Honest.** What you see is what runs. Open the source.

Built with [SolidStart](https://start.solidjs.com) (SSG), a single
Rust/WASM core (`toolcore`), WebGPU where it helps, and plain TypeScript
for everything else. No server-side code: the whole site is static HTML +
JS, deployable to any static host (GitHub Pages included).

## Quick start

```sh
pnpm install
pnpm dev          # http://localhost:3000 (assets copied automatically)
```

Other scripts:

```sh
pnpm typecheck    # tsc --noEmit
pnpm lint         # biome check .
pnpm test         # unit tests (vitest)
pnpm build        # production build (base path via VITE_BASE, default /)
pnpm start        # serve the built site
pnpm wasm         # rebuild the Rust/WASM core (needs wasm-pack)
pnpm og           # regenerate the Open Graph image
```

## Privacy model

All processing happens in the browser:

- JSON / YAML (format + convert): **toolcore** (Rust, `serde_json` +
  `serde_yaml` compiled to WebAssembly, ~440 KB, with a pure-JS fallback
  for JSON formatting when WASM fails to load).
- Pitch detection (guitar tuner): **toolcore** (YIN algorithm with an FFT
  via `rustfft`; SIMD where available).
- JWT signing/verification: **WebCrypto** (`crypto.subtle`) — no third-party
  crypto library; keys are handled in-browser and never persisted.
- Compass / level: **deviceorientation** + **WebGPU** (Canvas2D fallback).
- Ruler: pure DOM/CSS + device PPI.

No analytics, no telemetry, no cookies. See `src/site/config.ts` for the
donation wallet info shown in the footer (direct wallet addresses — no
intermediary).

## Layout

```
src/
  app.tsx            routes + shell
  document.tsx       <html> template, CSP, meta
  entry-client.tsx   browser entry (hydration)
  entry-server.tsx   SSG entry
  site/              config (brand, tools, wallets), seo, ads
  components/        Shell, AdSlot, Icons, RouteMeta, ...
  lib/               wasm loader, gpu, orientation, highlight, ...
  features/          one folder per tool: pure logic + unit tests
  routes/            one file per public URL (SSG prerenders each)
wasm/toolcore/       Rust crate (serde_json, serde_yaml, rustfft) →
                     wasm/toolcore/pkg/ (CI-built) → public/wasm/
scripts/             asset copy, sitemap/robots postbuild, og-image
docs/                architecture, ads, seo, deployment
```

Each tool is a route with its own lazy-loaded chunk; page bundles stay small
and the landing page prerenders to fully static HTML for search engines.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — framework, WASM core, WebGPU, SIMD.
- [Ads](docs/ADS.md) — how the (optional) AdSense slots stay non-intrusive.
- [SEO](docs/SEO.md) — prerendering, meta, JSON-LD, sitemap.
- [Deployment](docs/DEPLOYMENT.md) — GitHub Pages via Actions.

## License

MIT — see `LICENSE`.
