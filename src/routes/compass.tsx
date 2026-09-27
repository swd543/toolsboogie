/**
 * Compass — live heading from device sensors.
 *
 * The dial face is drawn once with WebGPU (a static fragment shader); the
 * moving parts (needle + cardinal marker) are DOM elements animated with a
 * CSS transform at ~30 Hz — cheap, and it composites on the GPU. When
 * WebGPU is unavailable the face falls back to a Canvas2D drawing.
 *
 * Heading quality depends on the device: iOS reports true magnetic
 * `webkitCompassHeading`; other platforms report the raw alpha axis, which
 * is only a true heading when the device lies roughly flat — the UI says so.
 */
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { AdSlot } from '~/components/AdSlot';
import { AlertIcon, CompassIcon } from '~/components/Icons';
import { RouteMeta } from '~/components/RouteMeta';
import { ToolColumns, ToolPage } from '~/components/Shell';
import { emaAngle, headingLabel } from '~/features/level/logic';
import { type CompassFace, makeCompassFace } from '~/lib/gpu';
import { requestSensorPermission, type SensorStatus, watchHeading } from '~/lib/orientation';
import { expandAds } from '~/site/ads';

export default function CompassPage() {
  const [status, setStatus] = createSignal<SensorStatus>('unsupported');
  const [heading, setHeading] = createSignal(0);
  const [smooth, setSmooth] = createSignal<number | null>(null);
  /** Continuous (UNWRAPPED) needle angle. The needle transform is
      `-needleDeg`, and CSS transitions interpolate numerically — if the
      angle were the 0..360 heading, crossing north (359° → 1°) would
      animate a full 358° sweep. Accumulating the per-tick deltas keeps
      consecutive values close, so the CSS always animates the short arc. */
  const [needleDeg, setNeedleDeg] = createSignal(0);
  const [everReading, setEverReading] = createSignal(false);
  const [started, setStarted] = createSignal(false);
  let cleanupHeading: (() => void) | null = null;
  let faceRef: CompassFace | null = null;
  let gpuCanvas: HTMLCanvasElement | undefined;
  let fallbackCanvas: HTMLCanvasElement | undefined;

  // Theme tracking for the shader uniform.
  const themeQuery =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  const [theme, setTheme] = createSignal(themeQuery?.matches ? 1 : 0);

  /** Redraw whatever layer is live (base 2D always; WebGPU face when up). */
  const redraw = () => {
    drawFallback();
    try {
      faceRef?.draw();
    } catch {
      /* the 2D base layer stays visible */
    }
  };

  themeQuery?.addEventListener('change', (e) => {
    setTheme(e.matches ? 1 : 0);
    redraw();
  });

  const smoothHeading = createMemo(() => smooth() ?? heading());

  const start = async () => {
    expandAds();
    const grant = await requestSensorPermission();
    if (grant === 'denied') {
      setStatus('denied');
      return;
    }
    cleanupHeading = watchHeading(
      (r) => {
        setEverReading(true);
        setHeading(r.heading);
        const prev = smooth();
        const next = prev === null ? r.heading : emaAngle(prev, r.heading, 0.25);
        if (prev === null) {
          // First reading (or re-enable): snap the unwrapped angle to the
          // closest representative of -next so the needle lands correctly
          // with a minimal jump.
          let d = (needleDeg() + next) % 360;
          if (d < 0) d += 360;
          if (d > 180) d -= 360;
          setNeedleDeg(needleDeg() - d);
        } else {
          // Shortest-arc delta from the previous smoothed heading — never
          // more than 180°, so the CSS transition always takes the short way.
          setNeedleDeg(needleDeg() + (((next - prev + 540) % 360) - 180));
        }
        setSmooth(next);
      },
      (s) => setStatus(s),
    );
    setStarted(true);
  };

  // Canvas2D fallback face (drawn once).
  const drawFallback = () => {
    const c = fallbackCanvas;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = Math.round(c.clientWidth * dpr);
    if (c.width !== size) {
      c.width = size;
      c.height = size;
    }
    const g = c.getContext('2d');
    if (!g) return;
    const dark = theme() === 1;
    const R = size / 2;
    g.clearRect(0, 0, size, size);
    g.beginPath();
    g.arc(R, R, R - 2, 0, Math.PI * 2);
    g.fillStyle = dark ? '#17181c' : '#f4f3ef';
    g.fill();
    g.lineWidth = 2 * dpr;
    g.strokeStyle = dark ? '#3a3b41' : '#d8d5cc';
    g.stroke();
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const major = deg % 90 === 0;
      const inner = R - (major ? 26 * dpr : 14 * dpr);
      g.beginPath();
      g.moveTo(R + Math.sin(rad) * inner, R - Math.cos(rad) * inner);
      g.lineTo(R + Math.sin(rad) * (R - 4 * dpr), R - Math.cos(rad) * (R - 4 * dpr));
      g.strokeStyle = major ? (dark ? '#e4e2da' : '#44423c') : dark ? '#3a3b41' : '#b8b4a8';
      g.lineWidth = (major ? 3 : 1.5) * dpr;
      g.stroke();
    }
    g.fillStyle = dark ? '#e4e2da' : '#44423c';
    g.font = `700 ${18 * dpr}px ui-monospace, monospace`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const cards: [string, number][] = [
      ['N', 0],
      ['E', 90],
      ['S', 180],
      ['W', 270],
    ];
    for (const [label, deg] of cards) {
      const rad = (deg * Math.PI) / 180;
      g.fillText(label, R + Math.sin(rad) * (R - 44 * dpr), R - Math.cos(rad) * (R - 44 * dpr));
    }
  };

  // Set up the face. Two stacked layers: the Canvas2D dial is ALWAYS drawn
  // (the visible base layer), then the WebGPU face layers on top. The WebGPU
  // face only covers the dial circle, so if it ever fails silently (a known
  // class of mobile-driver bug) the 2D dial underneath remains fully
  // visible — the compass can never render blank.
  const setupFace = async () => {
    drawFallback();
    if (gpuCanvas) {
      try {
        const f = await makeCompassFace(gpuCanvas, () => theme());
        if (f) {
          faceRef = f;
          f.draw();
          return;
        }
      } catch {
        /* the 2D base layer stays visible */
      }
    }
  };

  createEffect(() => {
    void setupFace();
  });

  // Phone rotation / resize: redraw both layers at the new size.
  const onResize = () => redraw();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', onResize);
  }

  onCleanup(() => {
    cleanupHeading?.();
    faceRef?.dispose();
    if (typeof window !== 'undefined') window.removeEventListener('resize', onResize);
  });

  /** Needle rotation. The dial is fixed (N at top on screen); the needle
      must rotate OPPOSITE to the device so it keeps pointing at magnetic
      north in world space: facing east (h=90) puts north 90° to your LEFT,
      i.e. the needle rotates -90° (counter-clockwise) on screen. */
  const rot = () => `${(0 - needleDeg()).toFixed(2)}deg`;
  const label = createMemo(() =>
    started() && everReading()
      ? headingLabel(smoothHeading())
      : status() === 'unsupported'
        ? 'no sensor API here'
        : 'waiting for sensor…',
  );

  return (
    <>
      <RouteMeta path="/compass" />
      <ToolPage
        tone="measure"
        title="Compass"
        lede="A live digital compass from your device's orientation sensors. Like a real compass, the needle moves opposite to the phone so it keeps pointing at magnetic north; the fixed marker at the top marks the direction you're facing. The dial is a WebGPU shader (Canvas2D fallback). Works best on phones and tablets."
        related={[
          { path: '/level', label: 'Level' },
          { path: '/guitar-tuner', label: 'Guitar tuner' },
          { path: '/ruler', label: 'Ruler' },
        ]}
      >
        <div class="compass-stage">
          <div class="compass">
            <canvas ref={(el) => (fallbackCanvas = el)} class="compass-fallback" />
            <canvas ref={(el) => (gpuCanvas = el)} class="compass-gpu" />
            <Show when={started()}>
              <div class="compass-index" aria-hidden="true" />
              <div class="compass-needle" style={{ '--compass-rot': rot() } as any}>
                <svg viewBox="0 0 24 110" aria-hidden="true">
                  <path class="compass-needle-n" d="M12 0 L19 55 L12 48 L5 55 Z" />
                  <path class="compass-needle-s" d="M12 110 L19 55 L12 62 L5 55 Z" />
                </svg>
              </div>
            </Show>
            <div class="compass-hub" />
          </div>
          <div class="compass-hint">
            {label()}
            <Show when={started() && everReading()}>
              <br />
              <strong>
                {smoothHeading().toFixed(1)}°{' '}
                {['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(smoothHeading() / 45) % 8]}
              </strong>
            </Show>
          </div>
        </div>

        <div class="cta" style="justify-content: center">
          <Show when={!started()} fallback={null}>
            <button type="button" class="btn btn-primary" onClick={() => void start()}>
              <CompassIcon /> Enable sensors
            </button>
          </Show>
          <Show when={started()}>
            <button
              type="button"
              class="btn btn-ghost"
              onClick={() => {
                cleanupHeading?.();
                cleanupHeading = null;
                setStarted(false);
                setSmooth(null);
                setEverReading(false);
              }}
            >
              Disable
            </button>
          </Show>
        </div>

        <Show when={typeof window !== 'undefined' && !window.isSecureContext}>
          <p class="http-note">
            This page is served over HTTP for now, so your browser may restrict motion sensors — iOS
            Safari only offers the permission prompt over HTTPS (Android still works over HTTP). The
            site switches to HTTPS automatically once its domain certificate is issued.
          </p>
        </Show>

        <ToolColumns
          aside={
            <div class="opt-group">
              <span class="opt-label">How it works</span>
              <p class="opt-hint">
                On iOS the browser exposes a calibrated magnetic heading (
                <code>webkitCompassHeading</code>) — true north after calibration. On other
                platforms the raw <code>alpha</code> axis is used, which only matches magnetic north
                while the device lies roughly flat; hold it flat and level it up.
              </p>
              <p class="opt-hint">
                No location, no network, no storage — the heading is computed on-device and
                discarded.
              </p>
              <Show when={status() === 'denied'}>
                <div class="error-card">
                  <AlertIcon />
                  <p>
                    Sensor permission was denied. Allow motion & orientation access in your browser
                    settings.
                  </p>
                </div>
              </Show>
            </div>
          }
        >
          <AdSlot slot="tool-bottom" />
        </ToolColumns>
      </ToolPage>
    </>
  );
}
