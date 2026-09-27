# Deployment

Target: **GitHub Pages** (repo `swd543/toolsboogie` → project site under
`https://swd543.github.io/toolsboogie/`), deployed by GitHub Actions — no
manual artifact uploading.

**Custom domain: `https://tools.bugaboxes.com`** — a DNS CNAME
(`tools.bugaboxes.com` → `swd543.github.io`) bound to the repo via the Pages
API (same setup as `pdf.bugaboxes.com`). GitHub binds the custom domain to
the site's **root**: `tools.bugaboxes.com/` serves the site, while
`swd543.github.io/toolsboogie/…` 301-redirects to `tools.bugaboxes.com/…`
(the project prefix is dropped). The build therefore uses base `/` and the
canonical absolute URLs are the bugaboxes ones. If the custom domain is ever
removed, flip `VITE_BASE` back to `/toolsboogie/` (see the comment in
`.github/workflows/ci.yml`).

## One workflow: `.github/workflows/ci.yml`

| Job | When | What it does |
|---|---|---|
| `wasm` | every push + PR | Rust toolchain + prebuilt `wasm-pack` → `wasm-pack build --target web` → uploads `wasm/toolcore/pkg` as the `toolcore-pkg` artifact |
| `test` | every push + PR | downloads `toolcore-pkg` → pnpm 11.13.1 + Node 24 → `typecheck` → `lint` (biome) → unit tests (vitest, incl. real-WASM integration tests) → production build (`VITE_BASE=/` + local `VITE_SITE_URL`) → `scripts/postbuild.mjs` |
| `deploy` | pushes to `main` | downloads `toolcore-pkg` → build with `VITE_BASE=/` + `VITE_SITE_URL=https://tools.bugaboxes.com` (custom domain is bound to the site root) → `upload-pages-artifact@v3` → `deploy-pages@v4` |

The **test** job builds with base `/` so the static output can be served
from a plain server root for smoke-testing. The **deploy** job also builds
with base `/` because the custom domain serves the site at the root (the
`github.io` project URL only 301-redirects to the custom domain). The base
path flows into the build via `VITE_BASE` (read by `vite.config.ts` and
`scripts/postbuild.mjs`).

## Manual / API steps (once per repo)

1. **Pages source = `GitHub Actions`** — set via the Pages API:
   `gh api -X POST repos/swd543/toolsboogie/pages -f build_type=workflow`
   (or Settings → Pages → Build and deployment → Source). Required, or
   Pages won't pick up the deploy artifact.
2. **Custom domain** — add a CNAME record `tools.bugaboxes.com` →
   `swd543.github.io` in the bugaboxes.com DNS zone, then bind it:
   `gh api -X PUT repos/swd543/toolsboogie/pages -f cname=tools.bugaboxes.com`.
   GitHub issues the Let's Encrypt certificate automatically once DNS
   resolves (watch `gh api repos/swd543/toolsboogie/pages` for
   `https_certificate.state = approved`), then enable HTTPS enforcement
   (Settings → Pages → Enforce HTTPS).
3. Push to `main` — the first run of `test` + `deploy` provisions the Pages
   site. Watch the `deploy` job; its `url` output is the live site.
3. Unknown URLs serve the generated `dist/404.html` (GitHub Pages' custom
   404 behavior) — no SPA fallback configuration needed, since routing is
   prerendered static files.

## Environment variables (build-time)

| Var | Default | Purpose |
|---|---|---|
| `VITE_BASE` | `/` | Asset/base path. The Pages deploy uses `/` — the custom domain serves the site at the root. |
| `VITE_SITE_URL` | `http://localhost:3000` | Absolute URL used in sitemap, robots, canonical and OG tags (deploy: `https://tools.bugaboxes.com`). |
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
