# Ads (AdSense)

ToolsBoogie is ad-ready but ships with **no ads by default**. When you
enable AdSense, the slots are deliberately **non-intrusive**:

1. **Collapsed until the visitor does something.** Ad slots render nothing
   (no `<ins>`, no `adsbygoogle` script, no network request, zero layout
   space) while the page is idle. The moment the visitor starts their first
   real operation (format, convert, sign, decode, tune…), the slots expand.
2. **They stay expanded.** Once expanded for the session, slots remain
   expanded after the operation finishes and across SPA navigation — the
   visitor isn't hit with a second "surprise" on the next tool.
3. **Graceful degradation.** Ad domains are commonly blocked (Pi-hole,
   ad blockers). The loader resolves on `onerror` and every call is
   wrapped, so a blocked ad network can never break a tool.

## How it works

- `src/site/ads.ts` — module-level `adsExpanded` signal + `expandAds()`.
  Idempotent, one-way, survives SPA navigation (module state, not route
  state).
- `src/components/AdSlot.tsx` — reads the signal. Collapsed: the slot
  renders `data-expanded="false"` (CSS `display:none`) and loads nothing.
  On first expansion a `createEffect` injects the AdSense loader script
  (with a dev-mode chip when `VITE_ADSENSE_CLIENT` is set), renders the
  `<ins class="adsbygoogle">`, and pushes `{}` through `window.adsbygoogle`.
- Each tool calls `expandAds()` right before starting work, so the slot
  appears as the work begins — never before the visitor has expressed
  intent.

## Enabling

```sh
cp .env.example .env
# set VITE_ADSENSE_CLIENT=ca-pub-XXXXXXXXXXXXXXXX
pnpm build
```

The client id is baked in at build time (it is public data — AdSense client
ids are visible on every ad-bearing site). Without it the site builds and
runs with the slots inert (collapsed and never expanding).

## What we do not do

- No ad injection before the first user action.
- No ad-frequency tricks, no cookie consent wall (there are no cookies).
- No ad-related analytics.
