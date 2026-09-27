import { describe, expect, it } from 'vitest';
import {
  centsLabel,
  FRAME_SIZE,
  isTuned,
  needleRotation,
  STANDARD_TUNING,
  type TunerState,
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
