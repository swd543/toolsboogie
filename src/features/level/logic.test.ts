import { describe, expect, it } from 'vitest';
import {
  applyCalibration,
  cardinal,
  ema,
  emaAngle,
  headingLabel,
  levelness,
  tiltAngle,
} from './logic';

describe('cardinal', () => {
  it('maps headings to 16-wind names', () => {
    expect(cardinal(0)).toBe('N');
    expect(cardinal(90)).toBe('E');
    expect(cardinal(180)).toBe('S');
    expect(cardinal(270)).toBe('W');
    expect(cardinal(22.5)).toBe('NNE');
    expect(cardinal(359)).toBe('N');
    expect(cardinal(-10)).toBe('N');
  });

  it('headingLabel formats degrees + cardinal', () => {
    expect(headingLabel(274.3)).toBe('274.3° W');
  });
});

describe('EMA', () => {
  it('smooths plain values', () => {
    expect(ema(null, 10, 0.3)).toBe(10);
    expect(ema(10, 20, 0.5)).toBe(15);
  });

  it('angle EMA takes the shortest arc (wrap-around)', () => {
    // 350° → 10°: the arc is +20°, not -340°.
    expect(emaAngle(350, 10, 1)).toBeCloseTo(10);
    const mid = emaAngle(350, 10, 0.5);
    expect(mid).toBeCloseTo(0); // halfway around the wrap = 0/360
  });
});

describe('level math', () => {
  it('tilt angle from beta/gamma', () => {
    expect(tiltAngle(0, 0)).toBe(0);
    expect(tiltAngle(3, 4)).toBe(5);
  });

  it('calibration subtracts the captured offset', () => {
    const c = applyCalibration(5.2, -1.1, { beta: 5.2, gamma: -1.1 });
    expect(c.beta).toBeCloseTo(0);
    expect(c.gamma).toBeCloseTo(0);
    expect(applyCalibration(5.2, -1.1, null)).toEqual({ beta: 5.2, gamma: -1.1 });
  });

  it('levelness is 1 in the deadband, 0 past max', () => {
    expect(levelness(0.2, 0.5, 15)).toBe(1);
    expect(levelness(0.5, 0.5, 15)).toBe(1);
    expect(levelness(15, 0.5, 15)).toBe(0);
    expect(levelness(7.75, 0.5, 15)).toBeCloseTo(0.5);
  });
});
