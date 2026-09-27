import { describe, expect, it } from 'vitest';
import {
  calibrateFromPpi,
  calibrateFromScreen,
  formatUnit,
  generateTicks,
  inferScreenCalibration,
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

describe('generateTicks (dual edge)', () => {
  it('generates metric 1/5/10 mm ticks with cm labels', () => {
    const cal = calibrateFromScreen(340, 1360); // 0.25 mm/px
    const { metric } = generateTicks(1360, cal);
    // ~340 mm → ~340 ticks (1 mm minor)
    expect(metric.length).toBeCloseTo(341, 0);
    const majors = metric.filter((t) => t.kind === 'major');
    expect(majors.length).toBe(35); // 0,10,...,340 mm
    expect(majors[0]!.label).toBe('0');
    expect(majors[1]!.label).toBe('1'); // 10 mm = 1 cm
    expect(majors[2]!.label).toBe('2');
  });

  it('generates imperial 1/16 in ticks with inch labels', () => {
    const cal = calibrateFromPpi(96); // 96 px/in
    const { imperial } = generateTicks(960, cal); // 10 inches
    const majors = imperial.filter((t) => t.kind === 'major');
    expect(majors.length).toBe(11); // 0..10 in
    expect(majors[0]!.label).toBe('0');
    expect(majors[1]!.label).toBe('1');
    // 16 minor/medium/major steps per inch (1/16 in)
    expect(imperial.length).toBe(160 + 1);
    expect(imperial[16]!.kind).toBe('major');
    expect(imperial[4]!.kind).toBe('medium'); // 1/4 in
  });

  it('thins the imperial step when marks get too dense (low PPI)', () => {
    const normal = calibrateFromPpi(96); // 1/16 in = 6 px apart
    const dense = calibrateFromPpi(24); // 1/16 in = 1.5 px apart → step doubles
    const { imperial: a } = generateTicks(96, normal); // 1 inch at 96 PPI
    const { imperial: b } = generateTicks(24, dense); // 1 inch at 24 PPI
    expect(a.length).toBe(17); // 16 × 1/16 in
    expect(b.length).toBe(9); // 8 × 1/8 in
  });
});

describe('inferScreenCalibration', () => {
  it('assumes 96 PPI at DPR 1', () => {
    const cal = inferScreenCalibration({ widthPx: 1366, heightPx: 768, dpr: 1 });
    expect(cal.mmPerPx).toBeCloseTo(MM_PER_INCH / 96, 6);
    expect(cal.estimated).toBe(true);
    expect(pxToUnit(96, cal, 'inch')).toBeCloseTo(1);
  });

  it('scales with devicePixelRatio (DPR 3 → 288 PPI)', () => {
    const cal = inferScreenCalibration({ widthPx: 412, heightPx: 915, dpr: 3 });
    expect(cal.mmPerPx).toBeCloseTo(MM_PER_INCH / 288, 6);
    expect(pxToUnit(288, cal, 'inch')).toBeCloseTo(1);
    expect(cal.source).toContain('288 PPI');
  });

  it('rejects bad viewport conditions', () => {
    expect(() => inferScreenCalibration({ widthPx: 0, heightPx: 800, dpr: 1 })).toThrow();
    expect(() => inferScreenCalibration({ widthPx: 100, heightPx: 800, dpr: 0 })).toThrow();
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
