/**
 * On-screen ruler logic: calibration + tick generation + unit math.
 *
 * Calibration: the user states a known physical size (screen width/height
 * in cm/inches, or pixels-per-inch directly). The rest is math — no
 * device APIs, so it works identically on desktop and mobile.
 */

export type Unit = 'mm' | 'cm' | 'inch';

export const MM_PER_INCH = 25.4;

export interface Calibration {
  /** Millimetres represented by one CSS pixel. */
  mmPerPx: number;
  source: string; // human-readable, e.g. "screen width 34.0 cm"
  /** True when the value was inferred from screen conditions, not measured. */
  estimated?: boolean;
}

/** Viewport/screen conditions used to infer a calibration. */
export interface InferViewport {
  /** Viewport width in CSS px (e.g. `window.innerWidth`). */
  widthPx: number;
  /** Viewport height in CSS px (e.g. `window.innerHeight`). */
  heightPx: number;
  /** `window.devicePixelRatio` (1 on a basic desktop, 2–3 on phones). */
  dpr: number;
}

/**
 * Infer a calibration from screen conditions alone — no user input.
 *
 * Browsers cannot measure a screen's physical size, but the classic
 * screen-resolution model is a decent estimate: CSS pixels are defined
 * at 96/inch, so the *effective* PPI of the rendered viewport is
 * `96 × devicePixelRatio`. A DPR-3 phone viewport is treated as 288 PPI,
 * a DPR-1 desktop as 96 PPI. The result is flagged `estimated` so the UI
 * can offer a manual override for exactness.
 */
export function inferScreenCalibration(v: InferViewport): Calibration {
  if (!(v.widthPx > 0) || !(v.heightPx > 0) || !(v.dpr > 0)) {
    throw new Error('Viewport size and devicePixelRatio must be positive numbers.');
  }
  const ppi = 96 * v.dpr;
  return {
    mmPerPx: MM_PER_INCH / ppi,
    source: `≈ ${Math.round(ppi)} PPI (estimated from devicePixelRatio ${String(v.dpr)})`,
    estimated: true,
  };
}

/**
 * Calibrate from a physical screen size:
 * `screenLengthMm` is the *rendered* edge length (in the current
 * orientation), `cssPixels` the CSS pixels along that same edge.
 */
export function calibrateFromScreen(screenLengthMm: number, cssPixels: number): Calibration {
  if (cssPixels <= 0 || screenLengthMm <= 0) {
    throw new Error('Screen size must be a positive number.');
  }
  return {
    mmPerPx: screenLengthMm / cssPixels,
    source: `${screenLengthMm.toFixed(1)} mm across ${Math.round(cssPixels)} px`,
  };
}

/** Calibrate from a direct pixels-per-inch statement. */
export function calibrateFromPpi(ppi: number): Calibration {
  if (!(ppi > 0)) throw new Error('PPI must be a positive number.');
  return {
    mmPerPx: MM_PER_INCH / ppi,
    source: `${ppi} PPI`,
  };
}

/** Convert a pixel length to millimetres. */
export function pxToMm(px: number, cal: Calibration): number {
  return px * cal.mmPerPx;
}

export function pxToUnit(px: number, cal: Calibration, unit: Unit): number {
  const mm = pxToMm(px, cal);
  if (unit === 'mm') return mm;
  if (unit === 'cm') return mm / 10;
  return mm / MM_PER_INCH;
}

/** Format a value in the unit with a sensible precision. */
export function formatUnit(value: number, unit: Unit): string {
  if (unit === 'mm') return `${value.toFixed(1)} mm`;
  if (unit === 'cm') return `${value.toFixed(2)} cm`;
  // inches: 2–3 decimals
  return `${value.toFixed(3)} in`;
}

/**
 * Dual-edge tick marks: one axis, two readings.
 *
 * Metric edge (read at the LEFT end): ticks every 1 mm, medium every 5 mm,
 * major + label every 10 mm (1 cm).
 * Imperial edge (read at the RIGHT end): ticks every 1/16 in, medium every
 * 1/4 in, major + label every 1 in.
 *
 * Both edges start at the same zero point, so the ruler reads metric from
 * the left and imperial from the right. Label density adapts to the
 * physical scale (a label is only drawn when its interval is wide enough
 * on screen).
 */
export interface Tick {
  x: number; // CSS px from the start of the axis
  kind: 'minor' | 'medium' | 'major';
  label?: string;
}

export interface DualTicks {
  metric: Tick[];
  imperial: Tick[];
}

/** Metric ticks with cm labels (0, 1, 2 …). */
function metricTicks(lengthPx: number, cal: Calibration): Tick[] {
  const mmTotal = pxToMm(lengthPx, cal);
  const ticks: Tick[] = [];
  if (mmTotal <= 0) return ticks;

  // Label every 1 cm when that's ≥ ~40 px on screen, else every 2 cm.
  const pxPer10mm = 10 / cal.mmPerPx;
  const labelEvery = pxPer10mm >= 40 ? 10 : pxPer10mm >= 20 ? 20 : 50;

  for (let mm = 0; mm <= mmTotal + 0.001; mm += 1) {
    const x = mm / cal.mmPerPx;
    const r = Math.round(mm);
    let kind: Tick['kind'] = 'minor';
    if (r % 10 === 0) kind = 'major';
    else if (r % 5 === 0) kind = 'medium';
    const tick: Tick = { x, kind };
    if (r % labelEvery === 0) {
      tick.label = String(r / 10); // cm, integral by construction
    }
    ticks.push(tick);
  }
  return ticks;
}

/** Imperial ticks with inch labels (0, 1, 2 …). */
function imperialTicks(lengthPx: number, cal: Calibration): Tick[] {
  const mmTotal = pxToMm(lengthPx, cal);
  const ticks: Tick[] = [];
  if (mmTotal <= 0) return ticks;

  // 1/16 in minor marks when they're ≥ ~5 px apart, else 1/8 in.
  const pxPer16th = MM_PER_INCH / 16 / cal.mmPerPx;
  const stepMm = pxPer16th >= 5 ? MM_PER_INCH / 16 : MM_PER_INCH / 8;

  const inches = mmTotal / MM_PER_INCH;
  const n = Math.floor(inches * (MM_PER_INCH / stepMm) + 1e-6);
  for (let i = 0; i <= n; i += 1) {
    const mm = i * stepMm;
    const x = mm / cal.mmPerPx;
    const sixteenths = Math.round((mm / MM_PER_INCH) * 16);
    let kind: Tick['kind'] = 'minor';
    if (sixteenths % 16 === 0) kind = 'major';
    else if (sixteenths % 4 === 0) kind = 'medium'; // 1/4 in
    const tick: Tick = { x, kind };
    if (sixteenths % 16 === 0) {
      tick.label = String(sixteenths / 16);
    }
    ticks.push(tick);
  }
  return ticks;
}

/** Ticks for both edges of the axis. */
export function generateTicks(lengthPx: number, cal: Calibration): DualTicks {
  return { metric: metricTicks(lengthPx, cal), imperial: imperialTicks(lengthPx, cal) };
}

/** Measure the distance between two points (CSS px → unit). */
export function measurePoints(
  a: { x: number; y: number },
  b: { x: number; y: number },
  cal: Calibration,
  unit: Unit,
): { px: number; text: string } {
  const px = Math.hypot(b.x - a.x, b.y - a.y);
  return { px, text: formatUnit(pxToUnit(px, cal, unit), unit) };
}

/** localStorage persistence for calibration + unit. */
const STORE_KEY = 'toolsboogie-ruler';

export interface RulerPrefs {
  unit: Unit;
  calibration: Calibration | null;
}

export function loadRulerPrefs(): RulerPrefs | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as RulerPrefs;
    if (!p || typeof p.unit !== 'string' || !['mm', 'cm', 'inch'].includes(p.unit)) return null;
    return p;
  } catch {
    return null;
  }
}

export function saveRulerPrefs(p: RulerPrefs): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    /* private mode etc. — non-fatal */
  }
}
