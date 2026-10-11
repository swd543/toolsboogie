/**
 * Stop-to-stop slide displacement from the device motion sensor.
 *
 * The phone starts at rest, the user presses to anchor, slides it along its
 * portrait device-Y axis, stops, then lifts. Live motion uses causal filtered
 * acceleration so the ruler responds immediately. At release, the complete
 * acceleration stroke is re-integrated with a constant-bias correction that
 * enforces zero starting and ending velocity.
 *
 * This is still inertial dead reckoning, not position tracking. It cannot
 * distinguish changing tilt from translation and works best for short,
 * straight, stop-to-stop strokes with the phone held in one orientation.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** One device motion sample (m/s², device axes). */
export interface MotionSample {
  /** DeviceMotionEvent timestamp, in ms. */
  t: number;
  /** accelerationIncludingGravity; null when unavailable. */
  raw: Vec3 | null;
  /** Platform linear acceleration, when provided. */
  linear?: Vec3 | null;
}

export type SlideQuality = 'idle' | 'live' | 'corrected' | 'uncertain';
type AccelSource = 'linear' | 'raw';

interface Segment {
  dt: number;
  /** Unfiltered, baseline-corrected device-Y acceleration. */
  a: number;
}

export interface SlideState {
  anchored: boolean;
  lastT: number | null;

  /** Idle gravity estimate for raw-acceleration fallback. */
  g: Vec3;
  gSeeded: boolean;
  /** Idle bias/noise estimate for platform linear acceleration. */
  linearBiasY: number;
  linearNoiseY: number;
  linearSamples: number;
  /** Idle noise estimate for raw Y minus gravity Y. */
  rawNoiseY: number;

  source: AccelSource | null;
  filteredAy: number;
  motionHits: number;
  moving: boolean;
  pending: Segment[];
  trace: Segment[];
  elapsed: number;

  /** Live velocity along device Y, m/s. */
  vy: number;
  /** Signed displacement along device Y, m. */
  disp: number;
  quality: SlideQuality;
}

const GRAVITY_ALPHA = 0.045;
const NOISE_ALPHA = 0.06;
const GRAVITY_REST_LIMIT = 1.2;
const DEFAULT_NOISE = 0.035;
const START_ACCEL_MIN = 0.12;
const START_ACCEL_MAX = 0.4;
const START_HITS = 2;
const LIVE_FILTER_HZ = 6;
const QUIET_BAND_MIN = 0.025;
const QUIET_BAND_MAX = 0.12;
const MAX_ACCEL = 12;
const DT_MIN = 0.0005;
const DT_MAX = 0.05;
const GAP_RESET = 0.12;
const MAX_TRACE_SECONDS = 12;
const MAX_RELEASE_BIAS = 2.5;
const MAX_CORRECTION_RATIO = 0.75;

const finite = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n);

const validVec = (v: Vec3 | null | undefined): v is Vec3 =>
  v !== null && v !== undefined && finite(v.x) && finite(v.y) && finite(v.z);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function initSlide(): SlideState {
  return {
    anchored: false,
    lastT: null,
    g: { x: 0, y: 0, z: 0 },
    gSeeded: false,
    linearBiasY: 0,
    linearNoiseY: DEFAULT_NOISE,
    linearSamples: 0,
    rawNoiseY: DEFAULT_NOISE,
    source: null,
    filteredAy: 0,
    motionHits: 0,
    moving: false,
    pending: [],
    trace: [],
    elapsed: 0,
    vy: 0,
    disp: 0,
    quality: 'idle',
  };
}

/** Start a new measurement. Idle calibration is deliberately retained. */
export function anchor(s: SlideState): void {
  s.anchored = true;
  s.lastT = null;
  s.source = null;
  s.filteredAy = 0;
  s.motionHits = 0;
  s.moving = false;
  s.pending = [];
  s.trace = [];
  s.elapsed = 0;
  s.vy = 0;
  s.disp = 0;
  s.quality = 'live';
}

/**
 * Finish the stroke and remove constant acceleration bias.
 *
 * For a stop-to-stop gesture, integral(a - bias) dt = 0. Therefore the
 * best constant bias is integral(a) / duration. Re-integrating with that
 * bias removed forces final velocity to zero without artificial damping.
 */
export function release(s: SlideState): void {
  if (!s.anchored) return;
  s.anchored = false;
  s.lastT = null;

  if (!s.moving || s.trace.length < 2 || s.elapsed <= 0) {
    s.vy = 0;
    s.quality = 'idle';
    return;
  }

  const wasUncertain = s.quality === 'uncertain';
  let measuredDv = 0;
  for (const segment of s.trace) measuredDv += segment.a * segment.dt;
  const bias = measuredDv / s.elapsed;

  if (!Number.isFinite(bias) || Math.abs(bias) > MAX_RELEASE_BIAS) {
    s.vy = 0;
    s.quality = 'uncertain';
    return;
  }

  let velocity = 0;
  let correctedDisp = 0;
  for (const segment of s.trace) {
    const a = segment.a - bias;
    const nextVelocity = velocity + a * segment.dt;
    correctedDisp += ((velocity + nextVelocity) / 2) * segment.dt;
    velocity = nextVelocity;
  }

  if (!Number.isFinite(correctedDisp)) {
    s.vy = 0;
    s.quality = 'uncertain';
    return;
  }

  const liveMagnitude = Math.max(Math.abs(s.disp), 0.002);
  const correctionRatio = Math.abs(correctedDisp - s.disp) / liveMagnitude;
  s.disp = correctedDisp;
  s.vy = 0;
  s.quality = !wasUncertain && correctionRatio <= MAX_CORRECTION_RATIO ? 'corrected' : 'uncertain';
}

/** Zero the held reading without starting another stroke. */
export function resetReading(s: SlideState): void {
  s.disp = 0;
  s.vy = 0;
  s.lastT = null;
  s.source = null;
  s.filteredAy = 0;
  s.motionHits = 0;
  s.moving = false;
  s.pending = [];
  s.trace = [];
  s.elapsed = 0;
  s.quality = 'idle';
}

/** Current distance in metres. */
export function readingM(s: SlideState): number {
  return Math.abs(s.disp);
}

export function slideQuality(s: SlideState): SlideQuality {
  return s.quality;
}

function updateIdleCalibration(s: SlideState, raw: Vec3 | null, linear: Vec3 | null): void {
  if (raw) {
    if (!s.gSeeded) {
      s.g = { ...raw };
      s.gSeeded = true;
    } else {
      const delta = Math.hypot(raw.x - s.g.x, raw.y - s.g.y, raw.z - s.g.z);
      if (delta < GRAVITY_REST_LIMIT) {
        s.g.x += GRAVITY_ALPHA * (raw.x - s.g.x);
        s.g.y += GRAVITY_ALPHA * (raw.y - s.g.y);
        s.g.z += GRAVITY_ALPHA * (raw.z - s.g.z);
        const residualY = Math.abs(raw.y - s.g.y);
        s.rawNoiseY += NOISE_ALPHA * (residualY - s.rawNoiseY);
      }
    }
  }

  if (linear) {
    if (s.linearSamples === 0) {
      s.linearBiasY = linear.y;
    } else {
      const residual = linear.y - s.linearBiasY;
      if (Math.abs(residual) < GRAVITY_REST_LIMIT) {
        s.linearBiasY += GRAVITY_ALPHA * residual;
        s.linearNoiseY += NOISE_ALPHA * (Math.abs(residual) - s.linearNoiseY);
      }
    }
    s.linearSamples += 1;
  }
}

function selectSource(s: SlideState, raw: Vec3 | null, linear: Vec3 | null): AccelSource | null {
  if (s.source) return s.source;
  if (linear && s.linearSamples >= 3) s.source = 'linear';
  else if (raw && s.gSeeded) s.source = 'raw';
  return s.source;
}

function appendTrace(s: SlideState, segment: Segment): void {
  if (s.elapsed >= MAX_TRACE_SECONDS) {
    s.quality = 'uncertain';
    return;
  }
  s.trace.push(segment);
  s.elapsed += segment.dt;
}

function integrateLive(s: SlideState, a: number, dt: number): void {
  const previousVelocity = s.vy;
  s.vy += a * dt;
  s.disp += ((previousVelocity + s.vy) / 2) * dt;
}

/** Fold one sensor sample into idle calibration or the active stroke. */
export function feed(s: SlideState, m: MotionSample): void {
  const raw = validVec(m.raw) ? m.raw : null;
  const linear = validVec(m.linear) ? m.linear : null;
  if (!raw && !linear) return;

  if (!s.anchored) {
    updateIdleCalibration(s, raw, linear);
    return;
  }

  // If the page was pressed before its first sensor event, use the first raw
  // sample as gravity and wait for the next sample before measuring.
  if (!s.gSeeded && raw) {
    s.g = { ...raw };
    s.gSeeded = true;
  }
  if (s.linearSamples === 0 && linear) {
    s.linearBiasY = linear.y;
    s.linearSamples = 1;
    if (!raw) {
      s.lastT = m.t;
      return;
    }
  } else if (!raw && linear && s.linearSamples < 3) {
    s.linearBiasY += GRAVITY_ALPHA * (linear.y - s.linearBiasY);
    s.linearSamples += 1;
    s.lastT = m.t;
    if (s.linearSamples < 3) return;
  }

  const source = selectSource(s, raw, linear);
  if (!source) return;

  if (s.lastT == null) {
    s.lastT = m.t;
    return;
  }
  const rawDt = (m.t - s.lastT) / 1000;
  s.lastT = m.t;
  if (!Number.isFinite(rawDt) || rawDt < DT_MIN) return;
  if (rawDt > GAP_RESET) {
    s.quality = 'uncertain';
    return;
  }
  const dt = Math.min(rawDt, DT_MAX);

  let ay: number;
  let noise: number;
  if (source === 'linear') {
    if (!linear) return;
    ay = linear.y - s.linearBiasY;
    noise = s.linearNoiseY;
  } else {
    if (!raw) return;
    ay = raw.y - s.g.y;
    noise = s.rawNoiseY;
  }
  ay = clamp(ay, -MAX_ACCEL, MAX_ACCEL);

  const filterAlpha = 1 - Math.exp(-2 * Math.PI * LIVE_FILTER_HZ * dt);
  s.filteredAy += filterAlpha * (ay - s.filteredAy);
  const startThreshold = clamp(noise * 4, START_ACCEL_MIN, START_ACCEL_MAX);

  if (!s.moving) {
    s.pending.push({ dt, a: ay });
    if (s.pending.length > START_HITS + 1) s.pending.shift();
    s.motionHits = Math.abs(s.filteredAy) >= startThreshold ? s.motionHits + 1 : 0;
    if (s.motionHits < START_HITS) return;

    s.moving = true;
    for (const segment of s.pending) {
      appendTrace(s, segment);
      integrateLive(s, segment.a, segment.dt);
    }
    s.pending = [];
    return;
  }

  appendTrace(s, { dt, a: ay });
  const quietBand = clamp(noise * 2, QUIET_BAND_MIN, QUIET_BAND_MAX);
  const liveAy = Math.abs(s.filteredAy) < quietBand ? 0 : s.filteredAy;
  integrateLive(s, liveAy, dt);
}
