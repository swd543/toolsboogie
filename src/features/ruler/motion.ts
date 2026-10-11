/**
 * Slide displacement from the device motion sensor.
 *
 * Model: the phone is held flat in portrait next to the object being
 * measured. The user presses the screen (anchor = zero), slides the phone
 * physically along the object, and lifts. While anchored, the linear
 * acceleration along the device's vertical axis (bottom edge to top edge)
 * is integrated to estimate how far the phone travelled.
 *
 * Gravity is removed with a low-pass estimate of the raw signal (the
 * high-pass residual is the linear acceleration). Velocity gets a very
 * light damping so drift slowly relaxes without eating real motion. The
 * result is an approximation: steady slides over ~10 cm read best.
 */

/** One device motion sample (m/s², device axes). */
export interface MotionSample {
  /** DeviceMotionEvent.timestamp, in ms. */
  t: number;
  /** accelerationIncludingGravity; null when unavailable (desktop). */
  raw: { x: number; y: number; z: number } | null;
  /** e.acceleration (gravity already removed) when the platform provides it. */
  linear?: { x: number; y: number; z: number } | null;
}

export interface SlideState {
  anchored: boolean;
  lastT: number | null;
  /** Low-pass gravity estimate (m/s², device axes). */
  g: { x: number; y: number; z: number };
  gSeeded: boolean;
  /** Velocity along the device Y axis, m/s. */
  vy: number;
  /** Net displacement along the device Y axis, m. */
  disp: number;
}

/** Low-pass factor for the gravity estimate (closer to 1 = slower to track). */
const GRAVITY_SMOOTH = 0.92;
/**
 * The gravity estimate only tracks the raw signal while the phone is
 * (nearly) at rest. During a slide the raw signal contains real
 * acceleration; letting the estimate chase it would eat the very motion
 * we integrate.
 */
const REST_THRESHOLD = 0.8;
/** Velocity damping time constant, s (drift relaxes, real motion barely touched). */
const DRIFT_TAU = 30;
/** Sample gaps above this are clamped (s) - big gaps are drift, not motion. */
const DT_MAX = 0.05;

export function initSlide(): SlideState {
  return {
    anchored: false,
    lastT: null,
    g: { x: 0, y: 0, z: 0 },
    gSeeded: false,
    vy: 0,
    disp: 0,
  };
}

/**
 * Finger pressed: start a new measurement at zero.
 * Re-anchoring resets the reading - the previous slide is discarded.
 */
export function anchor(s: SlideState): void {
  s.anchored = true;
  s.vy = 0;
  s.disp = 0;
  s.lastT = null;
  // Keep the gravity estimate: it is still valid.
}

/** Finger lifted: freeze the reading (it holds until the next anchor or a reset). */
export function release(s: SlideState): void {
  s.anchored = false;
  s.vy = 0;
}

/** Zero the reading without anchoring (the Reset button). */
export function resetReading(s: SlideState): void {
  s.disp = 0;
  s.vy = 0;
  s.lastT = null;
}

/** The current reading in metres (distance, always non-negative). */
export function readingM(s: SlideState): number {
  return Math.abs(s.disp);
}

const finite = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n);

/**
 * Fold one motion sample into the state.
 * No-op unless anchored; updates the gravity estimate either way so it
 * stays fresh while the finger is down before the slide begins.
 */
export function feed(s: SlideState, m: MotionSample): void {
  const raw = m.raw;
  if (!raw || !finite(raw.x) || !finite(raw.y) || !finite(raw.z)) return;

  // Keep the gravity estimate current - but ONLY at rest while not
  // measuring. Once anchored, the estimate is frozen and everything that
  // deviates from it is slide signal; re-converging during a slide would
  // absorb a slow steady slide (< the rest threshold) into "gravity" and
  // the reading would go to zero.
  if (!s.gSeeded) {
    s.g = { x: raw.x, y: raw.y, z: raw.z };
    s.gSeeded = true;
  } else if (!s.anchored) {
    const mag = Math.hypot(raw.x - s.g.x, raw.y - s.g.y, raw.z - s.g.z);
    if (mag < REST_THRESHOLD) {
      s.g.x = GRAVITY_SMOOTH * s.g.x + (1 - GRAVITY_SMOOTH) * raw.x;
      s.g.y = GRAVITY_SMOOTH * s.g.y + (1 - GRAVITY_SMOOTH) * raw.y;
      s.g.z = GRAVITY_SMOOTH * s.g.z + (1 - GRAVITY_SMOOTH) * raw.z;
    }
  }

  if (!s.anchored) return;

  const lin = m.linear;
  const ay = lin && finite(lin.y) ? lin.y : raw.y - s.g.y;

  if (s.lastT == null) {
    s.lastT = m.t;
    return;
  }
  const dt = Math.min(Math.max((m.t - s.lastT) / 1000, 0.0005), DT_MAX);
  s.lastT = m.t;

  const v0 = s.vy;
  s.vy = (v0 + ay * dt) * Math.exp(-dt / DRIFT_TAU);
  s.disp += ((v0 + s.vy) / 2) * dt; // trapezoid
}
