# Deployment

Target: **GitHub Pages** (repo `swd543/toolsboogie` → live at
`https://swd543.github.io/toolsboogie/`, under the `/toolsboogie/` project
sub-path), deployed by GitHub Actions — no manual artifact uploading.

## One workflow: `.github/workflows/ci.yml`

| Job | When | What it does |
|---|---|---|
| `wasm` | every push + PR | Rust toolchain + prebuilt `wasm-pack` → `wasm-pack build --target web` → uploads `wasm/toolcore/pkg` as the `toolcore-pkg` artifact |
| `test` | every push + PR | downloads `toolcore-pkg` → pnpm 11.13.1 + Node 24 → `typecheck` → `lint` (biome) → unit tests (vitest, incl. real-WASM integration tests) → production build (`VITE_BASE=/` + local `VITE_SITE_URL`) → `scripts/postbuild.mjs` |
| `deploy` | pushes to `main` | downloads `toolcore-pkg` → build with `VITE_BASE=/toolsboogie/` + `VITE_SITE_URL=https://swd543.github.io/toolsboogie` → `upload-pages-artifact@v3` → `deploy-pages@v4` |

The **test** job builds with base `/` so the static output can be served
from a plain server root for smoke-testing; the **deploy** job builds with
the project sub-path so asset URLs resolve under `github.io/toolsboogie/`.
The base path flows into the build via `VITE_BASE` (read by
`vite.config.ts` and `scripts/postbuild.mjs`).

## Manual steps (once per repo)

1. **Settings → Pages → Build and deployment → Source: `GitHub Actions`**.
   (Required; otherwise Pages won't pick up the deploy artifact.)
2. Push to `main` — the first run of `test` + `deploy` provisions the Pages
   site. Watch the `deploy` job; its `url` output is the live site.
3. Unknown URLs serve the generated `dist/404.html` (GitHub Pages' custom
   404 behavior) — no SPA fallback configuration needed, since routing is
   prerendered static files.

## Environment variables (build-time)

| Var | Default | Purpose |
|---|---|---|
| `VITE_BASE` | `/` | Asset/base path. The Pages deploy uses `/toolsboogie/` (project site). |
| `VITE_SITE_URL` | `http://localhost:3000` | Absolute URL used in sitemap, robots, canonical and OG tags. |
| `VITE_ADSENSE_CLIENT` | *(unset → ads inert)* | AdSense client id, e.g. `ca-pub-…`. See [ADS](ADS.md). |

## Running locally against the production build

```sh
pnpm build && node scripts/postbuild.mjs
python3 -m http.server 8899 --directory dist   # serve the static output
```

`pnpm start` (vite preview) also works.

## Updating the WASM core

The Rust crate lives in `wasm/toolcore/`. `wasm/toolcore/pkg/` is a build
artifact (gitignored) — **nothing is committed**; CI compiles it in the
`wasm` job and both builds download the `toolcore-pkg` artifact. To rebuild
locally: install `rustup` + the `wasm32-unknown-unknown` target + `wasm-pack`
(available from `~/.cargo/bin`; do **not** rely on a distro `cargo`), then
`pnpm wasm` (writes `wasm/toolcore/pkg/`, which `scripts/copy-assets.mjs`
copies into `public/wasm/`). No git step is needed — just push the source
changes.

## Notes

- The unit suite (`pnpm test`) runs the **real** WASM core in Node via
  wasm-bindgen's Node target, so CI's `test` job exercises the compiled
  artifact without a browser.
- There is no runtime environment config: the site is static. The only
  runtime difference ever is the AdSense client id, baked in at build time.
