import { describe, expect, it } from 'vitest';
import {
  calibrateFromPpi,
  calibrateFromScreen,
  formatUnit,
  generateTicks,
  MM_PER_INCH,
  measurePoints,
  pxToUnit,
} from './logic';

describe('calibration', () => {
  it('screen size → mm/px', () => {
    const cal = calibrateFromScreen(340, 1360); // 34 cm across 1360 CSS px
    expect(cal.mmPerPx).toBeCloseTo(0.25);
    expect(pxToUnit(1360, cal, 'cm')).toBeCloseTo(34);
  });

  it('PPI → mm/px (96 PPI ≈ 0.2646 mm/px)', () => {
    const cal = calibrateFromPpi(96);
    expect(cal.mmPerPx).toBeCloseTo(MM_PER_INCH / 96, 6);
    expect(pxToUnit(96, cal, 'inch')).toBeCloseTo(1);
  });

  it('rejects bad input', () => {
    expect(() => calibrateFromScreen(0, 100)).toThrow();
    expect(() => calibrateFromPpi(-1)).toThrow();
  });
});

describe('formatUnit', () => {
  it('formats with sensible precision', () => {
    expect(formatUnit(12.34, 'mm')).toBe('12.3 mm');
    expect(formatUnit(1.234, 'cm')).toBe('1.23 cm');
    expect(formatUnit(1.234, 'inch')).toBe('1.234 in');
  });
});

describe('generateTicks', () => {
  it('generates 1/5/10 mm ticks with adaptive labels', () => {
    const cal = calibrateFromScreen(340, 1360); // 0.25 mm/px
    const ticks = generateTicks(1360, cal, 'mm');
    // ~340 mm → ~340 ticks (1 mm minor)
    expect(ticks.length).toBeCloseTo(341, 0);
    const majors = ticks.filter((t) => t.kind === 'major');
    expect(majors.length).toBe(35); // 0,10,...,340
    expect(majors[0]!.label).toBe('0');
    expect(majors[1]!.label).toBe('10');
  });

  it('labels in the selected unit', () => {
    const cal = calibrateFromPpi(96);
    const ticks = generateTicks(960, cal, 'inch'); // 10 inches
    const labeled = ticks.filter((t) => t.label);
    expect(labeled.length).toBeGreaterThan(0);
  });
});

describe('measurePoints', () => {
  it('measures diagonals correctly', () => {
    const cal = calibrateFromScreen(340, 1360);
    const { px, text } = measurePoints({ x: 0, y: 0 }, { x: 3, y: 4 }, cal, 'cm');
    expect(px).toBe(5);
    expect(text).toBe('0.13 cm');
  });
});
