/**
 * Ruler — a calibrated on-screen ruler.
 *
 * No device APIs involved (which is honest: browsers can't know your
 * screen size). You calibrate once — screen width/height in cm/inches, or
 * PPI — and the ruler renders in CSS pixels with real-world scale, plus
 * two-point measuring. Calibration persists in localStorage.
 */
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { AdSlot } from '~/components/AdSlot';
import { CopyIcon } from '~/components/Icons';
import { RouteMeta } from '~/components/RouteMeta';
import { ToolColumns, ToolPage } from '~/components/Shell';
import {
  type Calibration,
  calibrateFromPpi,
  calibrateFromScreen,
  generateTicks,
  loadRulerPrefs,
  measurePoints,
  pxToUnit,
  saveRulerPrefs,
  type Unit,
} from '~/features/ruler/logic';
import { copyText } from '~/lib/clipboard';

export default function RulerPage() {
  const [cal, setCal] = createSignal<Calibration | null>(loadRulerPrefs()?.calibration ?? null);
  const [unit, setUnit] = createSignal<Unit>(loadRulerPrefs()?.unit ?? 'mm');
  const [copied, setCopied] = createSignal(false);

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
  let hover: { x: number; y: number } | null = null;

  const persist = () => {
    if (cal()) saveRulerPrefs({ unit: unit(), calibration: cal() });
  };

  const setUnitPersist = (u: Unit) => {
    setUnit(u);
    persist();
  };

  const applyCalibration = (c: Calibration) => {
    setCal(c);
    persist();
  };

  const widthPx = createMemo(() => wrap?.clientWidth ?? 0);
  const heightPx = 46;

  const draw = () => {
    const c = canvas;
    const cc = cal();
    if (!c || !cc || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = wrap.clientWidth;
    if (w <= 0) return;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(heightPx * dpr);
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, heightPx);

    const ticks = generateTicks(w, cc, unit());
    const top = 10;
    for (const t of ticks) {
      const len = t.kind === 'major' ? 16 : t.kind === 'medium' ? 11 : 7;
      g.beginPath();
      g.moveTo(t.x, top);
      g.lineTo(t.x, top + len);
      g.lineWidth = t.kind === 'major' ? 1.5 : 1;
      g.strokeStyle = 'var(--ink-muted)';
      g.stroke();
      if (t.label !== undefined) {
        g.font = '10px ui-monospace, monospace';
        g.fillStyle = 'var(--ink-faint)';
        g.textAlign = 'center';
        g.fillText(t.label, t.x, top + len + 9);
      }
    }
    // Baseline
    g.beginPath();
    g.moveTo(0, top);
    g.lineTo(w, top);
    g.lineWidth = 1.5;
    g.strokeStyle = 'var(--line-strong)';
    g.stroke();

    // Measure points (when both set)
    if (pts.a && pts.b) {
      const a = { x: pts.a.x, y: top + 8 };
      const b = { x: pts.b.x, y: top + 8 };
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

  // Redraw on resize + calibration change.
  const hasRaf = typeof requestAnimationFrame === 'function';
  createEffect(() => {
    void widthPx();
    void cal();
    void unit();
    if (!hasRaf) return; // server render — no animation frame
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  });

  onCleanup(() => {
    if (hasRaf) cancelAnimationFrame(raf);
  });

  const onMove = (e: PointerEvent) => {
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    hover = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (pts.active && !pts.b) {
      pts.b = hover;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    }
  };

  const onDown = (e: PointerEvent) => {
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    pts.a = p;
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
        title="On-screen ruler"
        lede="A straight-edge for your screen: calibrate once with your display's real size (or PPI), then measure distances in millimetres, centimetres or inches. Click-drag on the ruler to measure between two points. The calibration stays on this device."
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
          aria-label="On-screen ruler"
        >
          <canvas ref={(el) => (canvas = el)} class="ruler-canvas" style="height: 46px" />
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
                  <p class="opt-hint">
                    Not calibrated yet — enter your screen size below. (Measuring a sheet of paper
                    held against the screen works too, if you don't know your display's specs.)
                  </p>
                }
              >
                <p class="opt-hint" style="color: var(--color-ok)">
                  Calibrated: <b>{cal()!.source}</b>
                </p>
                <button type="button" class="btn btn-sm btn-ghost" onClick={() => setCal(null)}>
                  Reset calibration
                </button>
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
                Display unit
              </span>
              <div class="flag-row">
                {(['mm', 'cm', 'inch'] as Unit[]).map((u) => (
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
                ? `Full width: ${pxToUnit(widthPx() || 0, cal()!, unit()) === 0 ? '—' : formatTotal()}`
                : 'Set a calibration to read lengths.'}{' '}
              The ruler uses your browser's CSS pixels, so zoom affects it — keep browser zoom at
              100%.
            </p>
          </div>
          <AdSlot slot="tool-bottom" />
        </ToolColumns>
      </ToolPage>
    </>
  );

  function formatTotal(): string {
    const c = cal();
    if (!c) return '';
    const v = pxToUnit(widthPx() || 0, c, unit());
    return unit() === 'mm'
      ? `${v.toFixed(1)} mm`
      : unit() === 'cm'
        ? `${v.toFixed(2)} cm`
        : `${v.toFixed(3)} in`;
  }
}
