/**
 * Ruler — a literal on-screen ruler with two edges:
 * metric (cm) read at the LEFT end, imperial (inches) at the RIGHT.
 *
 * Calibration infers itself from screen conditions — the classic 96-DPI
 * model scaled by `devicePixelRatio` (DPR 3 phone → 288 PPI) — and is
 * flagged as an estimate. The user can override it with the display's
 * real size (cm/mm/inches) or a direct PPI value for exactness. Manual
 * calibration persists in localStorage; inferred values do not, so a new
 * device re-infers for itself.
 */
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { AdSlot } from '~/components/AdSlot';
import { CopyIcon } from '~/components/Icons';
import { RouteMeta } from '~/components/RouteMeta';
import { ToolColumns, ToolPage } from '~/components/Shell';
import {
  type Calibration,
  calibrateFromPpi,
  calibrateFromScreen,
  generateTicks,
  inferScreenCalibration,
  loadRulerPrefs,
  measurePoints,
  pxToUnit,
  saveRulerPrefs,
  type Unit,
} from '~/features/ruler/logic';
import { copyText } from '~/lib/clipboard';

/** Canvas height (CSS px): baseline + ticks + one label row. */
const RULER_H = 56;
const TOP = 8;
const LABEL_Y = TOP + 25;
const DIVIDER_H = 16;

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

  let canvas: HTMLCanvasElement | undefined;
  let wrap: HTMLDivElement | undefined;
  let raf = 0;
  let pts: {
    a: { x: number; y: number } | null;
    b: { x: number; y: number } | null;
    active: boolean;
  } = {
    a: null,
    b: null,
    active: false,
  };

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

  // Client-only: restore prefs or infer, and track the viewport size.
  onMount(() => {
    const prefs = loadRulerPrefs();
    if (prefs) setUnit(prefs.unit);
    setCal(prefs?.calibration ?? inferNow() ?? null);
    setViewW(window.innerWidth);
    setViewH(window.innerHeight);
  });

  const widthPx = createMemo(() => measuredW());

  const draw = () => {
    const c = canvas;
    const cc = cal();
    if (!c || !cc || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth;
    if (w <= 0) return;
    if (w !== measuredW()) setMeasuredW(w); // feed the readout memos
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(RULER_H * dpr);
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, RULER_H);

    // Left/right split: the left half is metric (zero at the LEFT edge,
    // increasing rightward), the right half is imperial (zero at the RIGHT
    // edge, increasing leftward). The two scales meet at a center divider —
    // a dual-zero tape, so an object can be measured against either edge.
    const Z = w / 2;
    const mTicks = generateTicks(Z, cc).metric; // x from the left edge
    const iTicks = generateTicks(w - Z, cc).imperial; // x from the right edge

    for (const t of mTicks) {
      const len = t.kind === 'major' ? 16 : t.kind === 'medium' ? 11 : 7;
      g.beginPath();
      g.moveTo(t.x, TOP);
      g.lineTo(t.x, TOP + len);
      g.lineWidth = t.kind === 'major' ? 1.5 : 1;
      g.strokeStyle = 'var(--ink-muted)';
      g.stroke();
    }
    for (const t of iTicks) {
      const len = t.kind === 'major' ? 16 : t.kind === 'medium' ? 11 : 7;
      g.beginPath();
      g.moveTo(w - t.x, TOP);
      g.lineTo(w - t.x, TOP + len);
      g.lineWidth = t.kind === 'major' ? 1.5 : 1;
      g.strokeStyle = 'var(--ink-muted)';
      g.stroke();
    }

    g.font = '10px ui-monospace, monospace';
    g.fillStyle = 'var(--ink-faint)';
    // Metric labels (left half).
    for (const t of mTicks) {
      if (t.label === undefined) continue;
      if (t.x < 2) {
        g.textAlign = 'left';
        g.fillText(t.label, 16, LABEL_Y); // after the 'cm' hint
      } else {
        g.textAlign = 'center';
        g.fillText(t.label, Math.min(t.x, Z - 10), LABEL_Y);
      }
    }
    // Imperial labels (right half, mirrored).
    for (const t of iTicks) {
      if (t.label === undefined) continue;
      if (t.x < 2) {
        g.textAlign = 'right';
        g.fillText(t.label, w - 16, LABEL_Y); // before the 'in' hint
      } else {
        g.textAlign = 'center';
        g.fillText(t.label, Math.max(w - t.x, Z + 10), LABEL_Y);
      }
    }
    // Unit hints at each outer edge.
    g.font = '9px ui-sans-serif, sans-serif';
    g.textAlign = 'left';
    g.fillText('cm', 2, LABEL_Y);
    g.textAlign = 'right';
    g.fillText('in', w - 2, LABEL_Y);

    // Center divider between the two scales.
    g.beginPath();
    g.moveTo(Z, TOP);
    g.lineTo(Z, TOP + DIVIDER_H);
    g.lineWidth = 1.5;
    g.strokeStyle = 'var(--line-strong)';
    g.stroke();

    // Baseline
    g.beginPath();
    g.moveTo(0, TOP);
    g.lineTo(w, TOP);
    g.lineWidth = 1.5;
    g.strokeStyle = 'var(--line-strong)';
    g.stroke();

    // Measure points (when both set)
    if (pts.a && pts.b) {
      const a = { x: pts.a.x, y: TOP + 8 };
      const b = { x: pts.b.x, y: TOP + 8 };
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.setLineDash([5, 3]);
      g.lineWidth = 1.5;
      g.strokeStyle = 'var(--accent)';
      g.stroke();
      g.setLineDash([]);
      for (const p of [a, b]) {
        g.beginPath();
        g.arc(p.x, p.y, 4, 0, Math.PI * 2);
        g.fillStyle = 'var(--accent)';
        g.fill();
      }
    }
  };

  const measureText = createMemo(() => {
    const cc = cal();
    if (!cc || !pts.a || !pts.b) return '';
    const { px, text } = measurePoints(pts.a, pts.b, cc, unit());
    return `${text} · ${px.toFixed(0)} px`;
  });

  const copyMeasure = async () => {
    if (await copyText(measureText())) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  // Full width + viewport size, always in both systems.
  const fullWidthText = createMemo(() => {
    const c = cal();
    if (!c) return '';
    const w = widthPx() || 0;
    if (w <= 0) return '';
    return `${pxToUnit(w, c, 'cm').toFixed(2)} cm · ${pxToUnit(w, c, 'inch').toFixed(3)} in`;
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

  // Track viewport size (for the physical-size readout).
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

  // Redraw on resize + calibration change.
  const hasRaf = typeof requestAnimationFrame === 'function';
  createEffect(() => {
    void widthPx();
    void cal();
    if (!hasRaf) return; // server render - no animation frame
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  });

  onCleanup(() => {
    if (hasRaf) cancelAnimationFrame(raf);
  });

  const onMove = (e: PointerEvent) => {
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (pts.active && !pts.b) {
      pts.b = p;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    }
  };

  const onDown = (e: PointerEvent) => {
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    pts.a = { x: e.clientX - r.left, y: e.clientY - r.top };
    pts.b = null;
    pts.active = true;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  };

  const clearPoints = () => {
    pts = { a: null, b: null, active: false };
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  };

  return (
    <>
      <RouteMeta path="/ruler" />
      <ToolPage
        tone="measure"
        title="On-screen ruler"
        lede="A literal ruler for your screen: metric on the left half, imperial on the right - each zero at its outer edge, so you can measure against either side. It calibrates itself from your screen's pixel density (96 × devicePixelRatio - an estimate, flagged as such); enter your display's real size for exactness. Click-drag to measure between two points."
        related={[
          { path: '/level', label: 'Level' },
          { path: '/compass', label: 'Compass' },
        ]}
      >
        <div
          class="ruler-canvas-wrap"
          ref={(el) => (wrap = el)}
          onPointerMove={onMove}
          onPointerDown={onDown}
          role="img"
          aria-label="On-screen ruler: metric centimetres on the left half (zero at the left edge), imperial inches on the right half (zero at the right edge)"
        >
          <canvas ref={(el) => (canvas = el)} class="ruler-canvas" style={`height: ${RULER_H}px`} />
        </div>
        <div class="ruler-measure">
          <span>
            {measureText() || 'Click and drag on the ruler to measure between two points.'}
          </span>
          <Show when={measureText() !== ''}>
            <button type="button" class="btn btn-sm btn-ghost" onClick={copyMeasure}>
              <CopyIcon /> {copied() ? 'Copied ✓' : 'Copy'}
            </button>
            <button type="button" class="btn btn-sm btn-ghost" onClick={clearPoints}>
              Clear
            </button>
          </Show>
        </div>

        <ToolColumns
          aside={
            <div class="opt-group">
              <span class="opt-label">Calibration</span>
              <Show
                when={cal() !== null}
                fallback={
                  <>
                    <p class="opt-hint">
                      Not calibrated - re-infer from this screen, or enter your display size below.
                      (Measuring a sheet of paper held against the screen works too, if you don't
                      know its specs.)
                    </p>
                    <button type="button" class="btn btn-sm btn-ghost" onClick={reinfer}>
                      Re-infer from screen
                    </button>
                  </>
                }
              >
                <p class="opt-hint" style="color: var(--color-ok)">
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
          }
        >
          <div class="opt-group" style="margin-top: 0">
            <span class="opt-label">Reading</span>
            <p class="opt-hint">
              {cal()
                ? `Full width: ${fullWidthText() || '—'}`
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
