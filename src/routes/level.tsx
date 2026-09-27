/**
 * Level — bubble level from the accelerometer.
 *
 * The surface (grid, target ring, animated bubble with sphere shading) is a
 * WebGPU fragment shader fed per frame with tilt + levelness. When WebGPU is
 * unavailable, a Canvas2D rAF loop draws the same picture with gradients.
 *
 * "Calibrate" captures the current offset as the new zero — useful when the
 * device rests in a holder or a slightly-bent case.
 */
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { AdSlot } from '~/components/AdSlot';
import { AlertIcon, RefreshIcon } from '~/components/Icons';
import { RouteMeta } from '~/components/RouteMeta';
import { ToolColumns, ToolPage } from '~/components/Shell';
import { applyCalibration, type LevelCalibration, levelness } from '~/features/level/logic';
import { type LevelSurface, makeLevelSurface } from '~/lib/gpu';
import {
  requestSensorPermission,
  type SensorStatus,
  type TiltReading,
  watchTilt,
} from '~/lib/orientation';
import { expandAds } from '~/site/ads';

const clamp01 = (v: number) => Math.max(-1, Math.min(1, v));

export default function LevelPage() {
  const [status, setStatus] = createSignal<SensorStatus>('unsupported');
  const [reading, setReading] = createSignal<TiltReading | null>(null);
  const [cal, setCal] = createSignal<LevelCalibration | null>(null);
  const [started, setStarted] = createSignal(false);
  const [surface, setSurface] = createSignal<LevelSurface | null>(null);
  /** Demo mode: sliders drive the same pipeline when no sensor is present. */
  const [demoOn, setDemoOn] = createSignal(false);
  const [demoBeta, setDemoBeta] = createSignal(0);
  const [demoGamma, setDemoGamma] = createSignal(0);

  let cleanupTilt: (() => void) | null = null;
  let surfRef: LevelSurface | null = null;
  let gpuCanvas: HTMLCanvasElement | undefined;
  let fallbackCanvas: HTMLCanvasElement | undefined;
  let fallbackRaf = 0;

  const themeQuery =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const [theme, setTheme] = createSignal(themeQuery?.matches ? 1 : 0);
  themeQuery?.addEventListener('change', (e) => setTheme(e.matches ? 1 : 0));

  /** Effective tilt: sensor readings (calibrated) or the demo sliders. */
  const eff = createMemo(() => {
    if (demoOn()) {
      const beta = demoBeta();
      const gamma = demoGamma();
      const angle = Math.hypot(beta, gamma);
      return { beta, gamma, angle, level: levelness(angle) };
    }
    const r = reading();
    if (!r) return null;
    const { beta, gamma } = applyCalibration(r.beta, r.gamma, cal());
    const angle = Math.hypot(beta, gamma);
    return { beta, gamma, angle, level: levelness(angle) };
  });

  /** Feed the surface (WebGPU or the 2D fallback) whenever the tilt changes.
      A createEffect — not a memo — so the fallback canvas redraws too. */
  createEffect(() => {
    const e = eff();
    if (!e) return;
    surfRef?.set(clamp01(e.gamma / 15), clamp01(e.beta / 15), e.level);
    if (!surfRef) drawFallbackFrame();
  });

  const start = async () => {
    expandAds();
    const grant = await requestSensorPermission();
    if (grant === 'denied') {
      setStatus('denied');
      return;
    }
    cleanupTilt = watchTilt(
      (r) => {
        setReading(r);
      },
      (s) => setStatus(s),
    );
    setStarted(true);
  };

  const calibrate = () => {
    const r = reading();
    if (!r) return;
    setCal({ beta: r.beta, gamma: r.gamma });
  };

  /* ---------- Canvas2D fallback drawing ----------

  Function declaration (not const) so it is hoisted: the createEffect above
  may call it during the first synchronous run, before this binding's source
  position is reached. */

  function drawFallbackFrame() {
    const c = fallbackCanvas;
    if (!c) return;
    // No reading yet (or demo): draw the placeholder — centered bubble,
    // neutral ring — so the face is never blank.
    const e = eff() ?? { beta: 0, gamma: 0, angle: 0, level: 0 };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(c.clientWidth * dpr);
    if (size <= 0) return;
    if (c.width !== size) {
      c.width = size;
      c.height = size;
    }
    const g = c.getContext('2d');
    if (!g) return;
    const dark = theme() === 1;
    const R = size / 2;
    const face = dark ? '#17181c' : '#f4f3ef';
    const line = dark ? '#33343a' : '#d8d5cc';
    const ink = dark ? '#e4e2da' : '#34322c';
    const ok = dark ? '#4cc286' : '#1f7a4d';
    const accent = dark ? '#a78bfa' : '#6d28d9'; // measurement-group violet

    g.clearRect(0, 0, size, size);
    g.beginPath();
    g.arc(R, R, R - 2, 0, Math.PI * 2);
    g.fillStyle = face;
    g.fill();
    g.lineWidth = 2 * dpr;
    g.strokeStyle = line;
    g.stroke();

    // Grid
    g.strokeStyle = line;
    g.lineWidth = 1 * dpr;
    for (let k = -3; k <= 3; k += 1) {
      const off = (k * R) / 4;
      g.beginPath();
      g.moveTo(R + off, 4 * dpr);
      g.lineTo(R + off, size - 4 * dpr);
      g.stroke();
      g.beginPath();
      g.moveTo(4 * dpr, R + off);
      g.lineTo(size - 4 * dpr, R + off);
      g.stroke();
    }
    // Crosshair
    g.strokeStyle = ink;
    g.lineWidth = 1.6 * dpr;
    g.beginPath();
    g.moveTo(R, 4 * dpr);
    g.lineTo(R, size - 4 * dpr);
    g.moveTo(4 * dpr, R);
    g.lineTo(size - 4 * dpr, R);
    g.stroke();

    // Target ring (glows when level)
    const ringR = R * 0.16;
    g.beginPath();
    g.arc(R, R, ringR, 0, Math.PI * 2);
    g.lineWidth = (2 + 4 * e.level) * dpr;
    g.strokeStyle = e.level > 0.95 ? ok : ink;
    g.stroke();

    // Bubble
    const travel = R * 0.72;
    const bx = R + clamp01(e.gamma / 15) * travel;
    const by = R - clamp01(e.beta / 15) * travel;
    const br = R * 0.3;
    const body = e.level > 0.95 ? ok : accent;
    const grad = g.createRadialGradient(bx - br * 0.35, by - br * 0.35, br * 0.1, bx, by, br);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.25, body);
    grad.addColorStop(1, body);
    g.beginPath();
    g.arc(bx, by, br, 0, Math.PI * 2);
    g.fillStyle = grad;
    g.fill();
    g.lineWidth = 2 * dpr;
    g.strokeStyle = ink;
    g.stroke();
  }

  /* ---------- surface setup (WebGPU, then 2D loop) ---------- */

  const setup = async () => {
    if (gpuCanvas) {
      const s = await makeLevelSurface(gpuCanvas, () => theme());
      if (s) {
        surfRef = s;
        setSurface(s);
        // Prime the first frame.
        const e = eff();
        if (e) s.set(clamp01(e.gamma / 15), clamp01(e.beta / 15), e.level);
        return;
      }
    }
    // No WebGPU: run a lightweight rAF loop on the 2D canvas.
    const loop = () => {
      drawFallbackFrame();
      fallbackRaf = requestAnimationFrame(loop);
    };
    fallbackRaf = requestAnimationFrame(loop);
  };

  // Set up once after first render (canvels must be mounted).
  if (typeof window !== 'undefined') {
    queueMicrotask(() => {
      void setup();
    });
  }

  onCleanup(() => {
    cleanupTilt?.();
    surfRef?.dispose();
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(fallbackRaf);
  });

  const isLevel = createMemo(() => {
    const e = eff();
    return e !== null && e.level >= 0.98;
  });
  /** Readouts follow the effective tilt (sensor OR demo), so the demo
      sliders are reflected here too. */
  const tiltDeg = createMemo(() => eff()?.angle ?? null);
  const betaDeg = createMemo(() => eff()?.beta ?? null);
  const gammaDeg = createMemo(() => eff()?.gamma ?? null);
  const tiltText = createMemo(() => {
    const v = tiltDeg();
    return v !== null ? `${v.toFixed(1)}°` : '—';
  });
  const betaText = createMemo(() => {
    const v = betaDeg();
    return v !== null ? `${v.toFixed(1)}°` : '—';
  });
  const gammaText = createMemo(() => {
    const v = gammaDeg();
    return v !== null ? `${v.toFixed(1)}°` : '—';
  });

  return (
    <>
      <RouteMeta path="/level" />
      <ToolPage
        tone="measure"
        title="Level"
        lede="Turn your device into a bubble level. The surface is a WebGPU shader (Canvas2D fallback) with a target ring that turns green when you're flat; degree readout, a calibrate button and a no-sensors demo (drag the sliders) cover the rest. Sensor data never leaves the device."
        related={[
          { path: '/compass', label: 'Compass' },
          { path: '/ruler', label: 'Ruler' },
        ]}
      >
        <div class="level-stage">
          <div class="level-view">
            <canvas
              ref={(el) => (gpuCanvas = el)}
              class="level-gpu"
              data-ready={surface() ? 'true' : 'false'}
            />
            <canvas
              ref={(el) => (fallbackCanvas = el)}
              class="level-fallback"
              style={`visibility: ${surface() ? 'hidden' : 'visible'}`}
            />
          </div>
          <div class="level-readout">
            <div class="stat">
              <div class={`v ${isLevel() ? 'is-level' : ''}`}>{tiltText()}</div>
              <div class="k">tilt</div>
            </div>
            <div class="stat">
              <div class="v">{betaText()}</div>
              <div class="k">top↔bottom</div>
            </div>
            <div class="stat">
              <div class="v">{gammaText()}</div>
              <div class="k">left↔right</div>
            </div>
          </div>
        </div>

        <div class="cta" style="justify-content: center">
          <Show when={!started()}>
            <button type="button" class="btn btn-primary" onClick={() => void start()}>
              Enable sensors
            </button>
          </Show>
          <Show when={started()}>
            <button
              type="button"
              class="btn btn-ghost"
              onClick={calibrate}
              disabled={reading() === null}
            >
              <RefreshIcon /> Calibrate (set zero here)
            </button>
            <button
              type="button"
              class="btn btn-ghost"
              onClick={() => {
                cleanupTilt?.();
                cleanupTilt = null;
                setStarted(false);
                setReading(null);
              }}
            >
              Disable
            </button>
          </Show>
        </div>

        <ToolColumns
          aside={
            <>
              <div class="opt-group">
                <span class="opt-label">Demo — no motion sensors?</span>
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={demoOn()}
                    onChange={(e) => setDemoOn(e.currentTarget.checked)}
                  />
                  <span class="knob" />
                  <span class="toggle-text">Simulate tilt with sliders</span>
                </label>
                <Show when={demoOn()}>
                  <label class="range-row">
                    <span class="range-key">top↔bottom</span>
                    <input
                      type="range"
                      min={-15}
                      max={15}
                      step={0.1}
                      value={demoBeta()}
                      onInput={(e) => setDemoBeta(parseFloat(e.currentTarget.value))}
                    />
                    <output>{demoBeta().toFixed(1)}°</output>
                  </label>
                  <label class="range-row">
                    <span class="range-key">left↔right</span>
                    <input
                      type="range"
                      min={-15}
                      max={15}
                      step={0.1}
                      value={demoGamma()}
                      onInput={(e) => setDemoGamma(parseFloat(e.currentTarget.value))}
                    />
                    <output>{demoGamma().toFixed(1)}°</output>
                  </label>
                  <p class="opt-hint">
                    The sliders drive the exact pipeline the sensor uses — watch the bubble, the
                    ring and the readout react.
                  </p>
                </Show>
              </div>
              <div class="opt-group">
                <span class="opt-label">Notes</span>
                <p class="opt-hint">
                  “Tilt” is the combined angle from flat; the ring glows green within 0.5°. Hold the
                  device face-up for stable readings — the bubble shows which way to tilt.
                </p>
                <p class="opt-hint">
                  Calibrate if the device rests in a case or holder; the offset is applied until you
                  disable the sensor or reload.
                </p>
                <Show when={status() === 'denied'}>
                  <div class="error-card">
                    <AlertIcon />
                    <p>
                      Motion permission was denied. Allow motion & orientation access in your
                      browser settings.
                    </p>
                  </div>
                </Show>
              </div>
            </>
          }
        >
          <AdSlot slot="tool-bottom" />
        </ToolColumns>
      </ToolPage>
    </>
  );
}
