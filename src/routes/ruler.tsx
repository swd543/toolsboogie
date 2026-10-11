/**
 * Ruler — a literal on-screen ruler with two edges:
 * metric (cm) down the LEFT edge, imperial (inches) down the RIGHT.
 *
 * The rulers run the full height of the screen (zero at the top, just
 * below the header), so you can measure heights against either side.
 *
 * Calibration infers itself from screen conditions — the classic 96-DPI
 * model scaled by `devicePixelRatio` (DPR 3 phone → 288 PPI) — and is
 * flagged as an estimate. The user can override it with the display's
 * real size (cm/mm/inches) or a direct PPI value for exactness. Manual
 * calibration persists in localStorage; inferred values do not.
 *
 * Slide measurement (motion sensor): press the screen to anchor at zero,
 * slide the phone physically along the object and lift - the
 * `devicemotion` acceleration along the device's vertical axis is
 * integrated to estimate the distance slid (features/ruler/motion.ts).
 * An approximation by nature; re-pressing resets to zero.
 */
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { AdSlot } from '~/components/AdSlot';
import { RouteMeta } from '~/components/RouteMeta';
import { ToolColumns, ToolPage } from '~/components/Shell';
import {
  type Calibration,
  calibrateFromPpi,
  calibrateFromScreen,
  formatUnit,
  generateTicks,
  inferScreenCalibration,
  loadRulerPrefs,
  MM_PER_INCH,
  pxToUnit,
  saveRulerPrefs,
  type Unit,
} from '~/features/ruler/logic';
import {
  anchor,
  feed,
  initSlide,
  type MotionSample,
  readingM,
  release,
  resetReading,
  type SlideState,
} from '~/features/ruler/motion';
import { copyText } from '~/lib/clipboard';
import { requestSensorPermission } from '~/lib/orientation';

/** Width of each edge strip (CSS px): ticks + label room. */
const STRIP_W = 56;
/** Label offset from the screen edge. */
const LABEL_X = 18;
/** A press that roams this far across the screen is a scroll, not an anchor. */
const SCROLL_CANCEL_PX = 12;
/** UI update throttle for the live slide reading (ms). */
const UI_INTERVAL_MS = 80;
/** Elements that keep working while the ruler overlay is up. */
const INTERACTIVE = 'button, a, input, select, textarea, .site-nav-drop, .ruler-measure';

function inferNow(): Calibration | null {
  try {
    if (typeof window === 'undefined') return null;
    return inferScreenCalibration({
      widthPx: window.innerWidth,
      heightPx: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    });
  } catch {
    return null;
  }
}

export default function RulerPage() {
  // Start empty on both server and client (identical hydration DOM), then
  // apply stored prefs / the screen inference client-only in onMount.
  const [cal, setCal] = createSignal<Calibration | null>(null);
  const [unit, setUnit] = createSignal<Unit>('cm');
  const [copied, setCopied] = createSignal(false);
  const [viewW, setViewW] = createSignal(0);
  const [viewH, setViewH] = createSignal(0);
  const [measuredW, setMeasuredW] = createSignal(0);

  // Slide-measurement state: the integrated value lives in a plain object
  // (mutated at sensor rate); the UI reads throttled signals.
  const slide: SlideState = initSlide();
  let gotMotion = false;
  let lastUiT = 0;
  const [reading, setReading] = createSignal(0); // metres
  const [anchored, setAnchored] = createSignal(false);
  const [sensed, setSensed] = createSignal(false);
  const [anchorPt, setAnchorPt] = createSignal<{ x: number; y: number } | null>(null);

  let canvas: HTMLCanvasElement | undefined;
  let raf = 0;
  let downPt: { x: number; y: number } | null = null;
  let anchorCancelled = false;

  const persist = () => {
    if (cal()) saveRulerPrefs({ unit: unit(), calibration: cal() });
  };

  const setUnitPersist = (u: Unit) => {
    setUnit(u);
    persist();
  };

  const applyCalibration = (c: Calibration, doPersist = true) => {
    setCal(c);
    if (doPersist) persist();
  };

  /** Re-derive the estimate from the current viewport (never persisted). */
  const reinfer = () => {
    const c = inferNow();
    if (c) applyCalibration(c, false);
  };

  const widthPx = createMemo(() => measuredW());

  /* ------------------------------------------------------------------ */
  /* Canvas: the two edge rulers                                          */
  /* ------------------------------------------------------------------ */

  const hasRaf = typeof requestAnimationFrame === 'function';
  const scheduleDraw = () => {
    if (!hasRaf) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  };

  const draw = () => {
    const c = canvas;
    const cc = cal();
    if (!c || !cc || typeof window === 'undefined') return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w <= 0 || h <= 0) return;
    if (w !== measuredW()) setMeasuredW(w); // feed the readout memos
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (c.width !== pw || c.height !== ph) {
      c.width = pw;
      c.height = ph;
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    // Theme-aware colours: read the live token values (the canvas does not
    // re-resolve CSS variables on its own, and a theme change would leave
    // stale light-mode ink on a dark background).
    const cs = getComputedStyle(c);
    const col = (n: string, fb: string) => cs.getPropertyValue(n).trim() || fb;
    const inkMuted = col('--ink-muted', '#5c5e66');
    const inkFaint = col('--ink-faint', '#9a9ca3');
    const lineStrong = col('--line-strong', '#c8c4b6');
    const accent = col('--accent', '#0b7285');

    // Zero sits just below the sticky header.
    const y0 = document.querySelector<HTMLElement>('.site-header')?.offsetHeight ?? 58;
    const len = h - y0;
    const ticks = generateTicks(len, cc);
    const tickLen = (k: 'minor' | 'medium' | 'major') =>
      k === 'major' ? 16 : k === 'medium' ? 11 : 7;

    // LEFT strip: metric, zero at the top, ticks pointing inward (right).
    for (const t of ticks.metric) {
      const y = y0 + t.x;
      if (y > h) continue;
      g.beginPath();
      g.moveTo(0.75, y);
      g.lineTo(tickLen(t.kind), y);
      g.lineWidth = t.kind === 'major' ? 1.5 : 1;
      g.strokeStyle = inkMuted;
      g.stroke();
    }
    // RIGHT strip: imperial, zero at the top, ticks pointing inward (left).
    for (const t of ticks.imperial) {
      const y = y0 + t.x;
      if (y > h) continue;
      g.beginPath();
      g.moveTo(w - 0.75, y);
      g.lineTo(w - tickLen(t.kind), y);
      g.lineWidth = t.kind === 'major' ? 1.5 : 1;
      g.strokeStyle = inkMuted;
      g.stroke();
    }

    g.font = '10px ui-monospace, monospace';
    g.fillStyle = inkFaint;
    g.textBaseline = 'middle';
    // Metric labels (left strip).
    for (const t of ticks.metric) {
      if (t.label === undefined) continue;
      const y = y0 + t.x;
      if (t.label !== '0' && (y < y0 + 8 || y > h - 8)) continue;
      g.textAlign = 'left';
      g.fillText(t.label, LABEL_X, t.label === '0' ? y0 + 12 : y);
    }
    // Imperial labels (right strip).
    for (const t of ticks.imperial) {
      if (t.label === undefined) continue;
      const y = y0 + t.x;
      if (t.label !== '0' && (y < y0 + 8 || y > h - 8)) continue;
      g.textAlign = 'right';
      g.fillText(t.label, w - LABEL_X, t.label === '0' ? y0 + 12 : y);
    }
    // Unit hints at each edge, just below the zero line.
    g.font = '9px ui-sans-serif, sans-serif';
    g.textAlign = 'left';
    g.fillText('cm', 2, y0 + 14);
    g.textAlign = 'right';
    g.fillText('in', w - 2, y0 + 14);

    // Baselines: the two screen edges + the zero line across each strip.
    g.strokeStyle = lineStrong;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0.75, y0);
    g.lineTo(0.75, h);
    g.stroke();
    g.beginPath();
    g.moveTo(w - 0.75, y0);
    g.lineTo(w - 0.75, h);
    g.stroke();
    g.beginPath();
    g.moveTo(0, y0);
    g.lineTo(STRIP_W, y0);
    g.stroke();
    g.beginPath();
    g.moveTo(w - STRIP_W, y0);
    g.lineTo(w, y0);
    g.stroke();

    // Anchor dot: the zero point of the current slide.
    const p = anchorPt();
    if (p) {
      g.beginPath();
      g.arc(p.x, p.y, 5, 0, Math.PI * 2);
      g.fillStyle = accent;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = lineStrong;
      g.stroke();
    }
  };

  /* ------------------------------------------------------------------ */
  /* Slide measurement (motion sensor)                                    */
  /* ------------------------------------------------------------------ */

  const onMotion = (e: DeviceMotionEvent) => {
    const raw = e.accelerationIncludingGravity;
    const lin = e.acceleration;
    // Chrome/Safari expose spec `timestamp`; TS's lib only declares the
    // Event base `timeStamp` - prefer the former, fall back to the latter.
    const t = (e as unknown as { timestamp?: number }).timestamp ?? e.timeStamp;
    const sample: MotionSample = {
      t: t,
      raw:
        raw && raw.x != null && raw.y != null && raw.z != null
          ? { x: raw.x, y: raw.y, z: raw.z }
          : null,
      linear:
        lin && lin.x != null && lin.y != null && lin.z != null
          ? { x: lin.x, y: lin.y, z: lin.z }
          : null,
    };
    if (!sample.raw && !sample.linear) return;
    if (slide.anchored) {
      if (!gotMotion) {
        gotMotion = true;
        setSensed(true);
      }
      feed(slide, sample);
      const now = performance.now();
      if (now - lastUiT > UI_INTERVAL_MS) {
        lastUiT = now;
        setReading(readingM(slide));
      }
    } else {
      // Keep the gravity estimate fresh while at rest.
      feed(slide, sample);
    }
  };

  const isInteractive = (t: EventTarget | null) =>
    t instanceof Element && t.closest(INTERACTIVE) !== null;

  const onWinDown = (e: PointerEvent) => {
    if (isInteractive(e.target)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    downPt = { x: e.clientX, y: e.clientY };
    anchorCancelled = false;
    anchor(slide);
    gotMotion = false;
    setAnchored(true);
    setSensed(false);
    setReading(0);
    setAnchorPt(downPt);
    // iOS 13+ needs the permission request inside the user gesture.
    void requestSensorPermission();
    scheduleDraw();
  };

  const onWinMove = (e: PointerEvent) => {
    // A press that roams across the screen is scrolling or interacting,
    // not an anchor - cancel it so normal page gestures keep working.
    if (!downPt || anchorCancelled) return;
    const d = Math.hypot(e.clientX - downPt.x, e.clientY - downPt.y);
    if (d > SCROLL_CANCEL_PX) {
      anchorCancelled = true;
      slide.anchored = false;
      setAnchored(false);
      setAnchorPt(null);
      scheduleDraw();
    }
  };

  const onWinUp = () => {
    downPt = null;
    if (anchorCancelled) {
      anchorCancelled = false;
      return;
    }
    release(slide);
    setAnchored(false);
    setReading(readingM(slide));
    scheduleDraw();
  };

  const resetAll = () => {
    resetReading(slide);
    setReading(0);
    if (!anchored()) setAnchorPt(null);
    scheduleDraw();
  };

  const copyReading = async () => {
    const txt = readingText();
    if (!txt) return;
    if (await copyText(txt)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Readouts                                                             */
  /* ------------------------------------------------------------------ */

  const readingText = createMemo(() => {
    const m = reading();
    if (m < 0.0005 && !anchored()) return '';
    const mm = m * 1000;
    const v = unit() === 'cm' ? mm / 10 : unit() === 'mm' ? mm : mm / MM_PER_INCH;
    return formatUnit(v, unit());
  });

  const chipText = createMemo(() => {
    if (anchored()) {
      if (!sensed()) return 'Anchored - now slide the phone along the object';
      return readingText() || formatUnit(0, unit());
    }
    if (reading() >= 0.0005) return readingText();
    return 'Press the screen to anchor at zero, then slide the phone along the object';
  });

  /** The ruler axis length: the viewport height. */
  const fullHeightText = createMemo(() => {
    const c = cal();
    if (!c) return '';
    const h = viewH() || 0;
    if (h <= 0) return '';
    return `${pxToUnit(h, c, 'cm').toFixed(2)} cm · ${pxToUnit(h, c, 'inch').toFixed(3)} in`;
  });

  const viewportText = createMemo(() => {
    const c = cal();
    if (!c) return '';
    const w = viewW() || 0;
    const h = viewH() || 0;
    if (w <= 0 || h <= 0) return '';
    return `${w}×${h} css px ≈ ${pxToUnit(w, c, 'cm').toFixed(1)} × ${pxToUnit(h, c, 'cm').toFixed(
      1,
    )} cm · ${pxToUnit(w, c, 'inch').toFixed(2)} × ${pxToUnit(h, c, 'inch').toFixed(2)} in`;
  });

  /* ------------------------------------------------------------------ */
  /* Wiring                                                               */
  /* ------------------------------------------------------------------ */

  const themeQuery =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const onThemeChange = () => scheduleDraw();

  // Track viewport size (physical-size readouts + canvas sizing).
  createEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      setViewW(window.innerWidth);
      setViewH(window.innerHeight);
    };
    onResize();
    addEventListener('resize', onResize);
    onCleanup(() => removeEventListener('resize', onResize));
  });

  // Redraw on resize, calibration or theme change.
  createEffect(() => {
    void widthPx();
    void viewH();
    void cal();
    scheduleDraw();
  });

  onMount(() => {
    const prefs = loadRulerPrefs();
    if (prefs) setUnit(prefs.unit);
    setCal(prefs?.calibration ?? inferNow() ?? null);
    setViewW(window.innerWidth);
    setViewH(window.innerHeight);
    addEventListener('devicemotion', onMotion);
    addEventListener('pointerdown', onWinDown);
    addEventListener('pointermove', onWinMove);
    addEventListener('pointerup', onWinUp);
    addEventListener('pointercancel', onWinUp);
    themeQuery?.addEventListener('change', onThemeChange);
    scheduleDraw();
  });

  onCleanup(() => {
    // SSR: these globals do not exist - only clients ever added listeners.
    if (typeof window !== 'undefined') {
      removeEventListener('devicemotion', onMotion);
      removeEventListener('pointerdown', onWinDown);
      removeEventListener('pointermove', onWinMove);
      removeEventListener('pointerup', onWinUp);
      removeEventListener('pointercancel', onWinUp);
    }
    themeQuery?.removeEventListener('change', onThemeChange);
    if (hasRaf) cancelAnimationFrame(raf);
  });

  return (
    <>
      <RouteMeta path="/ruler" />
      <div
        class="ruler-screen"
        role="img"
        aria-label="On-screen ruler: metric centimetres down the left edge and imperial inches down the right edge, both zero at the top. Press the screen and slide the phone along the object to measure longer distances."
      >
        <canvas ref={(el) => (canvas = el)} class="ruler-canvas" />
      </div>
      <div class="ruler-measure">
        <Show when={anchored()}>
          <span class="live-dot" />
        </Show>
        <span>{chipText()}</span>
        <Show when={anchored() || reading() >= 0.0005}>
          <button type="button" onClick={copyReading}>
            {copied() ? 'Copied ✓' : 'Copy'}
          </button>
          <button type="button" onClick={resetAll}>
            Reset
          </button>
        </Show>
      </div>
      <ToolPage
        tone="measure"
        title="On-screen ruler"
        lede="A literal ruler on the edges of your screen: metric down the left edge, imperial down the right, each zero at the top. Objects that fit the screen read straight off the scale. For anything longer, press the screen to anchor at zero, slide the phone along the object and lift - the motion sensor estimates the distance you slid (an approximation; steady slides read best, and pressing again resets to zero). The on-screen scale calibrates itself from your screen's pixel density (96 x devicePixelRatio - an estimate, flagged as such); enter your display's real size for exactness."
        related={[
          { path: '/level', label: 'Level' },
          { path: '/compass', label: 'Compass' },
        ]}
      >
        <ToolColumns
          aside={
            <>
              <div class="opt-group">
                <span class="opt-label">Slide measurement</span>
                <p class="opt-hint">
                  For objects longer than the screen: hold the phone flat in portrait, press the
                  screen to anchor at zero, slide the phone along the object and lift. The motion
                  sensor estimates the distance slid - an approximation, best with a steady slide.
                  Pressing again resets to zero.
                </p>
                <p class="opt-hint">
                  The slide reading needs a motion sensor (phones and tablets); on a desktop it
                  stays at zero and the on-screen scale is the tool.
                </p>
              </div>

              <div class="opt-group">
                <span class="opt-label">Calibration</span>
                <Show
                  when={cal() !== null}
                  fallback={
                    <>
                      <p class="opt-hint">
                        Not calibrated - re-infer from this screen, or enter your display size
                        below. (Measuring a sheet of paper held against the screen works too, if you
                        don't know its specs.)
                      </p>
                      <button type="button" class="btn btn-sm btn-ghost" onClick={reinfer}>
                        Re-infer from screen
                      </button>
                    </>
                  }
                >
                  <p class="opt-hint" style="color: var(--ok)">
                    {cal()!.estimated ? 'Estimated:' : 'Calibrated:'} <b>{cal()!.source}</b>
                  </p>
                  {cal()!.estimated ? (
                    <p class="opt-hint">
                      This estimate assumes the classic 96-DPI model scaled by your device pixel
                      ratio. Enter your screen's real size below for exactness.
                    </p>
                  ) : null}
                  <div style="display: flex; gap: 0.5rem">
                    <button type="button" class="btn btn-sm btn-ghost" onClick={reinfer}>
                      Re-infer from screen
                    </button>
                    <button type="button" class="btn btn-sm btn-ghost" onClick={() => setCal(null)}>
                      Reset
                    </button>
                  </div>
                </Show>

                <div class="field">
                  <span>Screen width</span>
                  <div style="display: flex; gap: 0.5rem">
                    <input
                      class="num-input"
                      type="number"
                      min="5"
                      step="0.1"
                      placeholder="34.0"
                      aria-label="Screen width"
                      id="rw-len"
                    />
                    <select
                      aria-label="Screen width unit"
                      onChange={(e) => {
                        const lenEl = document.getElementById('rw-len');
                        const len = Number(lenEl instanceof HTMLInputElement ? lenEl.value : '');
                        if (len > 0) {
                          const u = e.currentTarget.value;
                          const mm = u === 'cm' ? len * 10 : u === 'inch' ? len * 25.4 : len;
                          applyCalibration(calibrateFromScreen(mm, widthPx() || 1000));
                        }
                      }}
                    >
                      <option value="cm">cm</option>
                      <option value="mm">mm</option>
                      <option value="inch">inches</option>
                    </select>
                  </div>
                </div>
                <div class="field">
                  <span>… or PPI</span>
                  <input
                    class="num-input"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="e.g. 96"
                    aria-label="Pixels per inch"
                    onInput={(e) => {
                      const ppi = Number(e.currentTarget.value);
                      if (ppi > 0) applyCalibration(calibrateFromPpi(ppi));
                    }}
                  />
                </div>

                <span class="opt-label" style="margin-top: 0.75rem">
                  Measure in
                </span>
                <div class="flag-row">
                  {(['cm', 'mm', 'inch'] as Unit[]).map((u) => (
                    <button
                      type="button"
                      class={`chip ${unit() === u ? 'is-on' : ''}`}
                      aria-pressed={unit() === u}
                      onClick={() => setUnitPersist(u)}
                    >
                      {u === 'inch' ? 'inches' : u}
                    </button>
                  ))}
                </div>
                <p class="opt-hint">
                  Screen width = your display's measured edge length in the current orientation
                  (phone: the shorter edge). A typical 13″ laptop is ≈ 29.6 cm wide.
                </p>
              </div>
            </>
          }
        >
          <div class="opt-group" style="margin-top: 0">
            <span class="opt-label">On-screen scale</span>
            <p class="opt-hint">
              {cal()
                ? `Ruler length (top to bottom): ${fullHeightText() || '—'}`
                : 'Re-infer or calibrate to read lengths.'}{' '}
              {viewportText() !== ''
                ? `Viewport: ${viewportText()}${cal()!.estimated ? ' (estimated)' : ''}`
                : ''}{' '}
              The ruler uses your browser's CSS pixels, so browser zoom scales it - keep zoom at
              100% for real-world readings.
            </p>
          </div>
          <AdSlot slot="tool-bottom" />
        </ToolColumns>
      </ToolPage>
    </>
  );
}
