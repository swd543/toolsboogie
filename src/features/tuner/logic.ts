/**
 * Guitar tuner logic: note tables + display math. The audio pipeline
 * (AudioWorklet ring buffer → WASM YIN pitch detector) lives in the route;
 * this module is pure data/math and fully testable.
 */

export interface StringDef {
  id: string;
  note: string; // e.g. "E2"
  midi: number;
  hz: number;
  label: string; // UI label, e.g. "E · low"
}

/** Standard guitar tuning, low to high. */
export const STANDARD_TUNING: StringDef[] = [
  { id: 'e2', note: 'E2', midi: 40, hz: 82.407, label: 'E (low)' },
  { id: 'a2', note: 'A2', midi: 45, hz: 110.0, label: 'A' },
  { id: 'd3', note: 'D3', midi: 50, hz: 146.832, label: 'D' },
  { id: 'g3', note: 'G3', midi: 55, hz: 196.0, label: 'G' },
  { id: 'b3', note: 'B3', midi: 59, hz: 246.942, label: 'B' },
  { id: 'e4', note: 'E4', midi: 64, hz: 329.628, label: 'E (high)' },
];

export interface TunerState {
  /** Nearest note's MIDI number; -1 = nothing detected. */
  midi: number;
  note: string;
  /** Cents vs the nearest note (−50…+50). */
  cents: number;
  freq: number;
  rms: number;
}

/** In-tune window (±cents). */
export const TUNED_CENTS = 5;

export function isTuned(state: TunerState, targetMidi: number): boolean {
  if (state.midi < 0) return false;
  if (state.midi !== targetMidi) return false;
  return Math.abs(state.cents) <= TUNED_CENTS;
}

/** Display cents with a sign and flat/sharp glyph. */
export function centsLabel(state: TunerState): string {
  if (state.midi < 0) return '—';
  const c = Math.round(state.cents);
  if (Math.abs(state.cents) < 0.5) return '0¢ in tune';
  const arrow = state.cents < 0 ? '↓ flat' : '↑ sharp';
  return `${c > 0 ? '+' : ''}${c}¢ ${arrow}`;
}

/** Gauge rotation in degrees for the needle (−50…+50 cents → −45…+45°). */
export function needleRotation(cents: number, hasTone: boolean): number {
  if (!hasTone) return 0;
  const clamped = Math.max(-50, Math.min(50, cents));
  return (clamped / 50) * 45;
}

/** The MIDI number of the *target* open string (for the readout). */
export function targetString(midi: number): StringDef | undefined {
  return STANDARD_TUNING.find((s) => s.midi === midi);
}

/** Frame size for the audio pipeline (8192 samples ≈ 170 ms @ 48 kHz —
 *  long enough for the 82 Hz low E to resolve cleanly). */
export const FRAME_SIZE = 8192;

/** AudioWorklet source module URL (same-origin, CSP-friendly). */
export function workletUrl(base: string): string {
  return `${base.replace(/\/$/, '')}/worklet/tuner-worklet.js`;
}
