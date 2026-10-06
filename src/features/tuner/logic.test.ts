import { describe, expect, it } from 'vitest';
import {
  CUSTOM_MIDI_MAX,
  CUSTOM_MIDI_MIN,
  CUSTOM_TUNING_ID,
  centsLabel,
  FRAME_SIZE,
  isTuned,
  loadTunerPrefs,
  midiToHz,
  needleRotation,
  noteName,
  STANDARD_TUNING,
  saveTunerPrefs,
  stringsFor,
  TUNING_PRESETS,
  type TunerState,
  tuningMidis,
  workletUrl,
} from './logic';

describe('STANDARD_TUNING', () => {
  it('has the six open strings in order', () => {
    expect(STANDARD_TUNING.map((s) => s.note)).toEqual(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
    expect(STANDARD_TUNING[0]!.hz).toBeCloseTo(82.407, 3);
    expect(STANDARD_TUNING[5]!.hz).toBeCloseTo(329.628, 3);
  });

  it('MIDI numbers are consistent with frequencies', () => {
    for (const s of STANDARD_TUNING) {
      const hz = 440 * 2 ** ((s.midi - 69) / 12);
      expect(hz).toBeCloseTo(s.hz, 1);
    }
  });
});

describe('note names & notation', () => {
  it('matches the Rust core convention in sharps', () => {
    expect(noteName(69)).toBe('A4');
    expect(noteName(40)).toBe('E2');
    expect(noteName(55)).toBe('G3');
    expect(noteName(39)).toBe('D#2');
  });

  it('spells enharmonics with flats when asked', () => {
    expect(noteName(39, 'flat')).toBe('Eb2');
    expect(noteName(44, 'flat')).toBe('Ab2');
    expect(noteName(58, 'flat')).toBe('Bb3');
    expect(noteName(63, 'flat')).toBe('Eb4');
    expect(noteName(63, 'sharp')).toBe('D#4');
    // naturals are unaffected
    expect(noteName(69, 'flat')).toBe('A4');
    expect(noteName(40, 'flat')).toBe('E2');
  });

  it('midiToHz anchors A4 = 440', () => {
    expect(midiToHz(69)).toBeCloseTo(440, 9);
    expect(midiToHz(40)).toBeCloseTo(82.407, 2);
    expect(midiToHz(38)).toBeCloseTo(73.416, 2); // D2 (Drop D low string)
  });
});

describe('tuning presets', () => {
  it('has the documented open-string pitches, low to high', () => {
    const byId = Object.fromEntries(TUNING_PRESETS.map((p) => [p.id, p.midis]));
    expect(byId.standard).toEqual([40, 45, 50, 55, 59, 64]); // E A D G B E
    expect(byId['drop-d']).toEqual([38, 45, 50, 55, 59, 64]); // D A D G B E
    expect(byId['drop-c']).toEqual([36, 43, 48, 55, 59, 64]); // C G C D G E
    expect(byId['half-step-down']).toEqual([39, 44, 49, 54, 58, 63]);
    expect(byId['open-g']).toEqual([38, 43, 50, 55, 59, 62]); // D G D G B D
    expect(byId['open-d']).toEqual([38, 45, 50, 57, 62, 62]); // D A D F# A D
    expect(byId['open-e']).toEqual([40, 47, 52, 55, 59, 64]); // E B E G B E
    expect(byId.dadgad).toEqual([38, 45, 50, 55, 62, 62]); // D A D G A D
    expect(byId['double-drop-d']).toEqual([38, 45, 50, 55, 59, 62]); // D A D G B D
  });

  it('every preset is six strings within the custom range', () => {
    for (const p of TUNING_PRESETS) {
      expect(p.midis).toHaveLength(6);
      for (const m of p.midis) {
        expect(m).toBeGreaterThanOrEqual(CUSTOM_MIDI_MIN);
        expect(m).toBeLessThanOrEqual(CUSTOM_MIDI_MAX);
      }
    }
  });

  it('tuningMidis resolves presets, passes custom through (clamped), falls back to standard', () => {
    expect(tuningMidis('drop-d', [])).toEqual([38, 45, 50, 55, 59, 64]);
    expect(tuningMidis(CUSTOM_TUNING_ID, [40, 45, 50, 55, 59, 64])).toEqual([
      40, 45, 50, 55, 59, 64,
    ]);
    expect(tuningMidis(CUSTOM_TUNING_ID, [1, 45, 50, 55, 59, 999])).toEqual([
      CUSTOM_MIDI_MIN,
      45,
      50,
      55,
      59,
      CUSTOM_MIDI_MAX,
    ]);
    expect(tuningMidis('nope', [])).toEqual(tuningMidis('standard', []));
  });
});

describe('stringsFor', () => {
  it('labels duplicated pitch classes with the string number, uniques stay bare', () => {
    const labels = stringsFor([40, 45, 50, 55, 59, 64], 'sharp').map((s) => s.label);
    expect(labels).toEqual(['E2 6th', 'A2', 'D3', 'G3', 'B3', 'E4 1st']);
    const openG = stringsFor([38, 43, 50, 55, 59, 62], 'sharp').map((s) => s.label);
    expect(openG).toEqual(['D2 6th', 'G2 5th', 'D3 4th', 'G3 3rd', 'B3', 'D4 1st']);
  });

  it('honours notation in both note and label', () => {
    const flat = stringsFor([39, 44, 49, 54, 58, 63], 'flat');
    expect(flat.map((s) => s.note)).toEqual(['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4']);
    expect(flat[0]!.label).toBe('Eb2 6th');
    const sharp = stringsFor([39, 44, 49, 54, 58, 63], 'sharp');
    expect(sharp.map((s) => s.note)).toEqual(['D#2', 'G#2', 'C#3', 'F#3', 'A#3', 'D#4']);
  });

  it('frequencies match the MIDI numbers', () => {
    for (const s of stringsFor(TUNING_PRESETS[0]!.midis)) {
      expect(s.hz).toBeCloseTo(midiToHz(s.midi), 6);
    }
  });
});

describe('tuner prefs persistence', () => {
  it('returns null without a storage backend', () => {
    expect(loadTunerPrefs()).toBeNull();
    expect(() =>
      saveTunerPrefs({
        tuningId: 'standard',
        customMidis: [40, 45, 50, 55, 59, 64],
        notation: 'sharp',
      }),
    ).not.toThrow();
  });

  it('round-trips valid prefs and rejects corrupt ones', () => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    try {
      const prefs = {
        tuningId: 'drop-d',
        customMidis: [38, 45, 50, 55, 59, 64],
        notation: 'flat' as const,
      };
      saveTunerPrefs(prefs);
      expect(loadTunerPrefs()).toEqual(prefs);
      store.set(
        'toolsboogie-tuner',
        JSON.stringify({ tuningId: 'bogus', customMidis: [1], notation: 'weird' }),
      );
      expect(loadTunerPrefs()).toBeNull();
      store.set('toolsboogie-tuner', 'not json');
      expect(loadTunerPrefs()).toBeNull();
      // custom id requires a valid six-number custom list
      store.set(
        'toolsboogie-tuner',
        JSON.stringify({ tuningId: CUSTOM_TUNING_ID, customMidis: [], notation: 'sharp' }),
      );
      expect(loadTunerPrefs()).toBeNull();
    } finally {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  });
});
describe('display math', () => {
  const state = (midi: number, cents: number): TunerState => ({
    midi,
    note: 'X',
    cents,
    freq: 0,
    rms: 0,
  });

  it('isTuned only within the window on the target note', () => {
    expect(isTuned(state(64, 4), 64)).toBe(true);
    expect(isTuned(state(64, 6), 64)).toBe(false); // outside ±5
    expect(isTuned(state(55, 0), 64)).toBe(false); // wrong note
    expect(isTuned(state(-1, 0), 64)).toBe(false); // no tone
  });

  it('centsLabel formats flat/sharp/in-tune', () => {
    expect(centsLabel(state(-1, 0))).toBe('—');
    expect(centsLabel(state(64, 0))).toContain('in tune');
    expect(centsLabel(state(64, -12.4))).toBe('-12¢ ↓ flat');
    expect(centsLabel(state(64, 3.2))).toBe('+3¢ ↑ sharp');
  });

  it('needle rotation maps ±50¢ to ±45°', () => {
    expect(needleRotation(0, true)).toBe(0);
    expect(needleRotation(50, true)).toBe(45);
    expect(needleRotation(-50, true)).toBe(-45);
    expect(needleRotation(80, true)).toBe(45); // clamped
    expect(needleRotation(10, false)).toBe(0); // no tone → centered
  });
});

describe('audio pipeline constants', () => {
  it('frame size + worklet URL', () => {
    expect(FRAME_SIZE).toBe(8192);
    expect(workletUrl('/')).toBe('/worklet/tuner-worklet.js');
    expect(workletUrl('/toolsboogie/')).toBe('/toolsboogie/worklet/tuner-worklet.js');
  });
});
