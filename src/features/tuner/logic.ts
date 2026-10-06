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

/** How note names are spelled when displayed. */
export type Notation = 'sharp' | 'flat';

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Note name from a MIDI number, e.g. 40 -> "E2", 39 -> "D#2" (sharps) or "Eb2" (flats). */
export function noteName(midi: number, notation: Notation = 'sharp'): string {
  const idx = ((midi % 12) + 12) % 12;
  const octave = Math.trunc(midi / 12) - 1;
  const table = notation === 'flat' ? FLAT_NAMES : SHARP_NAMES;
  return `${table[idx]}${octave}`;
}

/** Frequency (Hz) of a MIDI number (A4 = 440 Hz). */
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export interface TuningPreset {
  id: string;
  name: string;
  /** MIDI of the six open strings, low (6th) to high (1st). */
  midis: [number, number, number, number, number, number];
}

/** Common six-string tunings. `standard` is first and the default. */
export const TUNING_PRESETS: TuningPreset[] = [
  { id: 'standard', name: 'Standard (EADGBE)', midis: [40, 45, 50, 55, 59, 64] },
  { id: 'drop-d', name: 'Drop D (DADGBE)', midis: [38, 45, 50, 55, 59, 64] },
  { id: 'drop-c', name: 'Drop C (CADGBE)', midis: [36, 43, 48, 55, 59, 64] },
  { id: 'half-step-down', name: 'Half-step down (EbAbDbGbBbEb)', midis: [39, 44, 49, 54, 58, 63] },
  { id: 'open-g', name: 'Open G (DGDGBD)', midis: [38, 43, 50, 55, 59, 62] },
  { id: 'open-d', name: 'Open D (DADF#AD)', midis: [38, 45, 50, 57, 62, 62] },
  { id: 'open-e', name: 'Open E (EBEGBE)', midis: [40, 47, 52, 55, 59, 64] },
  { id: 'dadgad', name: 'DADGAD (reentrant)', midis: [38, 45, 50, 55, 62, 62] },
  { id: 'double-drop-d', name: 'Double drop D (DADGBD)', midis: [38, 45, 50, 55, 59, 62] },
];

export const CUSTOM_TUNING_ID = 'custom';

/** MIDI range offered for custom string selection (C1 .. E6). */
export const CUSTOM_MIDI_MIN = 24;
export const CUSTOM_MIDI_MAX = 84;

/** String-number labels, low (6th) to high (1st). */
export const STRING_ORDINALS = ['6th', '5th', '4th', '3rd', '2nd', '1st'];

/** MIDI of the six open strings for a tuning id; unknown ids fall back to standard. */
export function tuningMidis(id: string, customMidis: number[]): number[] {
  const preset = TUNING_PRESETS.find((p) => p.id === id);
  if (preset) return [...preset.midis];
  if (id === CUSTOM_TUNING_ID) {
    return customMidis.map((m) => Math.max(CUSTOM_MIDI_MIN, Math.min(CUSTOM_MIDI_MAX, m)));
  }
  return [...TUNING_PRESETS[0]!.midis];
}

/**
 * String definitions for any six-string MIDI layout. When the same pitch
 * class is used on two strings the label carries the string number
 * ("E 6th" / "E 1st"), so duplicated notes stay unambiguous.
 */
export function stringsFor(midis: number[], notation: Notation = 'sharp'): StringDef[] {
  const count = new Map<number, number>();
  for (const m of midis)
    count.set(((m % 12) + 12) % 12, (count.get(((m % 12) + 12) % 12) ?? 0) + 1);
  return midis.map((m, i) => {
    const base = noteName(m, notation);
    const pc = ((m % 12) + 12) % 12;
    const label = count.get(pc) === 1 ? base : `${base} ${STRING_ORDINALS[i] ?? ''}`.trim();
    return { id: `s${i}-${m}`, note: base, midi: m, hz: midiToHz(m), label };
  });
}

/** localStorage persistence for tuning, custom strings and notation. */
const STORE_KEY = 'toolsboogie-tuner';

export interface TunerPrefs {
  tuningId: string;
  customMidis: number[];
  notation: Notation;
}

const DEFAULT_CUSTOM: number[] = STANDARD_TUNING.map((s) => s.midi);

export function loadTunerPrefs(): TunerPrefs | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as TunerPrefs;
    const notationOk = p?.notation === 'sharp' || p?.notation === 'flat';
    const customOk =
      Array.isArray(p?.customMidis) &&
      p.customMidis.length === 6 &&
      p.customMidis.every(
        (m) => Number.isInteger(m) && m >= CUSTOM_MIDI_MIN && m <= CUSTOM_MIDI_MAX,
      );
    const idOk =
      typeof p?.tuningId === 'string' &&
      (TUNING_PRESETS.some((t) => t.id === p.tuningId) || p.tuningId === CUSTOM_TUNING_ID);
    if (!notationOk || !idOk || (p.tuningId === CUSTOM_TUNING_ID && !customOk)) return null;
    return {
      tuningId: p.tuningId,
      customMidis: customOk ? p.customMidis : DEFAULT_CUSTOM,
      notation: p.notation,
    };
  } catch {
    return null;
  }
}

export function saveTunerPrefs(p: TunerPrefs): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(p));
  } catch {
    /* private mode etc. - non-fatal */
  }
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
