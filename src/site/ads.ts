/**
 * Site-wide ad state.
 *
 * Ads are non-intrusive by design: every AdSlot stays collapsed (no AdSense
 * request, zero layout footprint) until the visitor's FIRST operation starts
 * (format, convert, tune, sign…). `expandAds()` is called once at the start
 * of an operation; the module-level signal then keeps every slot expanded
 * for the rest of the page life — the ad persists after the operation
 * finishes (the visitor already saw it; no collapse/flicker, no CLS loop).
 */
import { createSignal } from 'solid-js';

const [getExpanded, setExpanded] = createSignal(false);

/** True once the visitor's first operation has started (readable in JSX). */
export const adsExpanded = getExpanded;

/** Idempotent: expand all ad slots now; stays expanded until page reload. */
export const expandAds = (): void => {
  setExpanded(true);
};
