# Architecture

ToolsBoogie is a static site: no server code, no build-time or runtime
dependency on a backend. The only "server" is a static file host.

## Framework: SolidStart (SSG mode)

- `solidStart()` + Nitro `preset: 'static'`: every route is prerendered to
  plain HTML at build time (`prerender: { crawlLinks: true }`), so search
  engines see full content and the site works with JS disabled for reading.
- File-based routing under `src/routes/` — one file per public URL. Each
  tool route is code-split: its chunk loads only when you open that tool,
  so the landing page stays tiny and the suite never loads all at once.
- `@solidjs/meta` drives per-route `<title>`/`<meta>`; JSON-LD is injected
  per route (see [SEO](SEO.md)).

### Two non-obvious framework quirks (patched)

1. **Lazy routes under SSG.** `renderToString` never resolves `lazy()`
   components; `renderToStream` resolves them only inside `<Suspense>`.
   SolidStart v2's router renders route outlets without a Suspense boundary,
   so SSR hung forever. Fix: a `pnpm patch` on `@solidjs/router` that wraps
   the route `outlet` in `<Suspense>` (see `patches/`, applied via
   `patchedDependencies` in `pnpm-workspace.yaml`).
2. **CSP nonce for static builds.** `document.tsx` emits a strict CSP with
   `script-src 'self' 'wasm-unsafe-eval' 'nonce-…'`. The nonce is a fixed
   build-time constant (injected from `vite.config.ts` → `entry-server.tsx`
   → `document.tsx` via `import.meta.env.SSR_NONCE`), so prerendered HTML
   and the hashed module scripts agree without a per-request server.
   `wasm-unsafe-eval` is required because instantiating the WASM core uses
   a compiled (non-Streaming) module in some engines. `frame-ancestors` is
   deliberately **not** in the meta CSP (it is ignored by browsers in
   `<meta>`; shipping it only produces a console warning).

## Compute split: WASM, WebGPU, SIMD

The rule of thumb: **use the fastest primitive the platform offers, and
degrade honestly**.

| Concern | Engine | Notes |
|---|---|---|
| JSON format/minify/sort | **toolcore** (Rust/WASM) | `serde_json`; pure-JS fallback if WASM fails. |
| JSON → YAML, YAML format | **toolcore** (Rust/WASM) | `serde_yaml`-style emitter. |
| Pitch detection | **toolcore** (Rust/WASM) | YIN autocorrelation + `rustfft` FFT. Scalar on stable; `wasm_simd` is a nightly opt-in (see below). |
| Compass dial, level bubble | **WebGPU** | Fullscreen-triangle compute-ish render (WGSL); Canvas2D fallback when WebGPU is unavailable or the canvas is lost. |
| Everything else | **plain TypeScript** | JWT (WebCrypto), regex, escape, time, ruler. |

The WASM core is a single crate (`wasm/toolcore`) with a stable, small API
surfaced through `src/lib/wasm.ts`. It is the *only* compiled artifact in
the bundle; everything it does is pure functions over bytes/arrays.

### Where SIMD is used (honestly)

- The spectral/autocorrelation hot loops in `pitch.rs` are written as
  allocation-free scalar code. `wasm32-unknown-unknown` SIMD lanes
  (`wasm_simd`) are a **nightly-only** feature, so the crate targets
  **stable** and does not emit hand-vectorized `f64x4` lanes. The heavy
  lifting is delegated to `rustfft`'s optimized radix plan, which is the
  real performance win. The loops are structured (no allocations, no
  per-sample branches) so a future `wasm_simd` port is a drop-in — but
  the shipped build is scalar and we say so.
- We do **not** claim SIMD for the tiny per-frame bookkeeping; that would
  be noise.

> If you run a nightly toolchain, enabling `#![feature(portable_simd)]`
> (or the `wasm_simd` crate) and vectorizing the `sum`/`mags` loops in
> `pitch.rs` is a localized, well-scoped change — the API and results are
> unchanged.

### Where WebGPU is used (honestly)

- **Compass**: the dial (cardinal ticks, needle, background) is a
  fullscreen-triangle WebGPU render (WGSL). This is a legitimate GPU use —
  it is a redrawn 2D scene every frame as the needle moves — but it is
  *not* required: a Canvas2D fallback renders the same dial and is used
  automatically when `navigator.gpu` is absent, the context fails, or the
  surface is lost. The *heading itself* comes from
  `deviceorientation`/Geolocation, never from the GPU.
- **Level**: the bubble surface is a WebGPU render (a radial gradient +
  a bubble disc whose position maps to tilt), with the same Canvas2D
  fallback. The *tilt* comes from `deviceorientation`, never from the GPU.
- **Not used for**: pitch, JSON, JWT, regex, escape, time, ruler. Those
  have no meaningful GPU workload; pushing them through WebGPU would add
  latency and risk for zero gain.

## Rust/WASM core (`wasm/toolcore`)

- `serde_json` + `serde_yaml` + `rustfft`, compiled with
  `wasm-pack --target web` → `wasm/toolcore/pkg/` (~440 KB `.wasm` + JS glue).
- API (via `src/lib/wasm.ts`): `init()`, `json_format(bytes, opts)`,
  `json_to_yaml(bytes)`, `yaml_format(bytes)`, `pitch(frame) → PitchResult`,
  plus `free_*` for returned allocates.
- **No build artifacts are committed.** `wasm/toolcore/pkg/` is a build
  output (gitignored). CI builds it in a dedicated `wasm` job (Rust
  toolchain + prebuilt `wasm-pack` binary → `toolcore-pkg` artifact), and
  the `test`/`deploy` jobs download it before `pnpm build`. Locally,
  `pnpm wasm` builds it (needs `rustup` + `wasm-pack` on PATH; do **not**
  use the distro rust — the system toolchain usually lacks the
  `wasm32-unknown-unknown` target). `scripts/copy-assets.mjs` (run on
  predev/prebuild) then copies `pkg/` → `public/wasm/`. If WASM fails to
  load in the browser, JSON formatting falls back to pure JS; the
  WASM-only tools (YAML) surface a clear "WASM unavailable" message.

### Rust-side gotchas

- `serde_yaml`'s `to_string` on `wasm32` allocates on the wasm heap; every
  returned `String` must be `free_*`'d by the caller (or the `String` is
  leaked). `src/lib/wasm.ts` owns the free calls.
- `rustfft` requires the planner to be built once per frame size; building
  it per call is a measurable hit, so it is cached.

## Features are pure modules

Every tool's logic lives in `src/features/<tool>/logic.ts` as plain async
functions, with a co-located `logic.test.ts` (vitest). The JSON/YAML/pitch
tests run the **real WASM core** in Node (wasm-bindgen's Node target), so
the unit suite exercises the compiled artifact, not a mock. Routes are thin:
file state, progress, error handling, DOM. This keeps the interesting code
testable in Node without a browser.

## WebAudio note (guitar tuner)

- Mic input goes through an `AudioWorklet` (`public/worklet/tuner-worklet.js`)
  that accumulates 8192-sample frames and posts each full frame to the main
  thread (transferred, not copied). The main thread hands the frame to the
  WASM `pitch()` and renders the gauge/spectrum.
- The worklet does **no DSP** — it only buffers — so it is tiny and stable
  across browsers, and the pitch algorithm stays in the testable Rust core.
- The worklet is loaded same-origin (CSP-safe).

## Mobile-first details

- Device-tilt tools (compass, level) require `deviceorientation`, which on
  iOS must be requested via a user gesture (`DeviceOrientationEvent.requestPermission`);
  the tools show a "tap to enable" gate on iOS and work without permission
  where it isn't required.
- Responsive: no horizontal overflow at 360/768/1280. The classic flex
  `min-width: auto` trap is handled on the header nav (scrolls) and footer
  (wraps).
- Ruler calibration is persisted in `localStorage` (the only storage the
  site ever uses); nothing is sent anywhere.
