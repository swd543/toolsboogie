/**
 * Compass + level shared math: cardinal names, heading display, tilt
 * smoothing (EMA) and calibration offsets.
 */

const CARDINALS_16 = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
] as const;

/** 16-wind cardinal name for a heading (0..360, 0 = north). */
export function cardinal(heading: number): string {
  const h = ((heading % 360) + 360) % 360;
  return CARDINALS_16[Math.round(h / 22.5) % 16] ?? 'N';
}

/** Formatted heading: "274.3° W". */
export function headingLabel(heading: number): string {
  const h = ((heading % 360) + 360) % 360;
  return `${h.toFixed(1)}° ${cardinal(h)}`;
}

/**
 * Exponential moving average for sensor values — cheap, stable, and
 * correct across wrapping headings (interpolates the shortest arc).
 */
export function emaAngle(prev: number | null, next: number, alpha: number): number {
  if (prev == null) return next;
  const delta = ((next - prev + 540) % 360) - 180; // shortest signed arc
  return (prev + delta * alpha + 360) % 360;
}

/** EMA for plain (non-wrapping) values. */
export function ema(prev: number | null, next: number, alpha: number): number {
  if (prev == null) return next;
  return prev + alpha * (next - prev);
}

/**
 * Level calibration: capture the current tilt as the new zero.
 * Offsets are applied to beta/gamma before the angle math.
 */
export interface LevelCalibration {
  beta: number;
  gamma: number;
}

export function applyCalibration(
  beta: number,
  gamma: number,
  cal: LevelCalibration | null,
): { beta: number; gamma: number } {
  if (!cal) return { beta, gamma };
  return { beta: beta - cal.beta, gamma: gamma - cal.gamma };
}

/** Tilt angle in degrees from (calibrated) beta/gamma. */
export function tiltAngle(beta: number, gamma: number): number {
  return Math.hypot(beta, gamma);
}

/**
 * Levelness 0..1 for the bubble UI: 1 when flat within `deadband`
 * degrees, falling to 0 at `maxAngle`.
 */
export function levelness(angle: number, deadband = 0.5, maxAngle = 15): number {
  if (angle <= deadband) return 1;
  if (angle >= maxAngle) return 0;
  return 1 - (angle - deadband) / (maxAngle - deadband);
}
