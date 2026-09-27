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
 * Tick marks for one axis: minor every 1 mm, medium every 5 mm,
 * major every 10 mm (labeled). Labeling adapts: when the canvas is
 * narrow, only 5 mm and 10 mm get labels.
 */
export interface Tick {
  x: number; // CSS px from the start of the axis
  kind: 'minor' | 'medium' | 'major';
  label?: string;
}

export function generateTicks(lengthPx: number, cal: Calibration, unit: Unit): Tick[] {
  const mmTotal = pxToMm(lengthPx, cal);
  const ticks: Tick[] = [];
  if (mmTotal <= 0) return ticks;

  // Label density: a label every 10 mm when that's ≥ ~70 px on screen.
  const pxPer10mm = 10 / cal.mmPerPx;
  const labelEvery = pxPer10mm >= 70 ? 10 : pxPer10mm >= 35 ? 5 : 10;

  for (let mm = 0; mm <= mmTotal + 0.001; mm += 1) {
    const x = mm / cal.mmPerPx;
    const roundedMm = Math.round(mm);
    let kind: Tick['kind'] = 'minor';
    if (roundedMm % 10 === 0) kind = 'major';
    else if (roundedMm % 5 === 0) kind = 'medium';
    const tick: Tick = { x, kind };
    if (roundedMm % labelEvery === 0) {
      const v = pxToUnit(x, cal, unit);
      tick.label = unit === 'mm' ? String(roundedMm) : formatUnit(v, unit).replace(/\s.*$/, '');
    }
    ticks.push(tick);
  }
  return ticks;
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
