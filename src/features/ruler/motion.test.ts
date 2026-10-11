import { describe, expect, it } from 'vitest';
import {
  anchor,
  feed,
  initSlide,
  type MotionSample,
  readingM,
  release,
  resetReading,
  type SlideState,
  slideQuality,
} from './motion';

const DT_MS = 1000 / 60;

function sample(t: number, ay: number, linearAy: number | null = null): MotionSample {
  return {
    t,
    raw: { x: 0, y: ay, z: -9.81 },
    linear: linearAy === null ? null : { x: 0, y: linearAy, z: 0 },
  };
}

function idle(s: SlideState, t: number, count = 60, linearBias: number | null = null): number {
  for (let i = 0; i < count; i += 1) {
    feed(s, sample(t, 0, linearBias));
    t += DT_MS;
  }
  return t;
}

function begin(s: SlideState, t: number, linearBias: number | null = null): number {
  anchor(s);
  feed(s, sample(t, 0, linearBias));
  return t + DT_MS;
}

function push(
  s: SlideState,
  t: number,
  count: number,
  ay: number,
  bias = 0,
  linear = false,
): number {
  for (let i = 0; i < count; i += 1) {
    const measured = ay + bias;
    feed(s, sample(t, measured, linear ? measured : null));
    t += DT_MS;
  }
  return t;
}

function trapezoid(s: SlideState, t: number, bias = 0, linear = false): number {
  t = push(s, t, 15, 2, bias, linear); // accelerate for ~0.25 s
  t = push(s, t, 60, 0, bias, linear); // cruise for ~1.0 s
  t = push(s, t, 15, -2, bias, linear); // decelerate to rest
  return push(s, t, 8, 0, bias, linear); // brief stopped hold before lift
}

describe('stop-to-stop gesture', () => {
  it('does nothing before an anchor', () => {
    const s = initSlide();
    let t = 0;
    t = idle(s, t);
    t = push(s, t, 30, 2);
    expect(t).toBeGreaterThan(0);
    expect(readingM(s)).toBe(0);
    expect(slideQuality(s)).toBe('idle');
  });

  it('measures an accelerate-cruise-decelerate stroke', () => {
    const s = initSlide();
    let t = idle(s, 0);
    t = begin(s, t);
    t = trapezoid(s, t);
    expect(readingM(s)).toBeGreaterThan(0.5); // live estimate moves
    release(s);
    expect(readingM(s)).toBeCloseTo(0.625, 1);
    expect(slideQuality(s)).toBe('corrected');
  });

  it('holds the final reading after release', () => {
    const s = initSlide();
    let t = idle(s, 0);
    t = begin(s, t);
    t = trapezoid(s, t);
    release(s);
    const held = readingM(s);
    t = push(s, t, 60, 4);
    expect(t).toBeGreaterThan(0);
    expect(readingM(s)).toBeCloseTo(held, 12);
  });

  it('re-anchoring and Reset both clear the stroke', () => {
    const s = initSlide();
    let t = idle(s, 0);
    t = begin(s, t);
    t = trapezoid(s, t);
    release(s);
    expect(readingM(s)).toBeGreaterThan(0.5);
    anchor(s);
    expect(readingM(s)).toBe(0);
    resetReading(s);
    expect(readingM(s)).toBe(0);
    expect(slideQuality(s)).toBe('idle');
  });
});

describe('calibration and drift rejection', () => {
  it('does not move for realistic at-rest noise', () => {
    const s = initSlide();
    let t = idle(s, 0);
    t = begin(s, t);
    for (let i = 0; i < 180; i += 1) {
      const noise = i % 4 === 0 ? 0.045 : i % 4 === 1 ? -0.035 : i % 4 === 2 ? 0.02 : -0.025;
      feed(s, sample(t, noise));
      t += DT_MS;
    }
    release(s);
    expect(readingM(s)).toBeLessThan(0.001);
  });

  it('removes constant sensor bias at release', () => {
    const s = initSlide();
    let t = idle(s, 0);
    t = begin(s, t);
    t = trapezoid(s, t, 0.25);
    const live = readingM(s);
    release(s);
    const corrected = readingM(s);
    expect(live).toBeGreaterThan(0.75); // biased causal integration drifts high
    expect(corrected).toBeCloseTo(0.625, 1);
    expect(corrected).toBeLessThan(live);
  });

  it('uses and calibrates platform linear acceleration when available', () => {
    const s = initSlide();
    const linearBias = 0.18;
    let t = idle(s, 0, 60, linearBias);
    t = begin(s, t, linearBias);
    t = trapezoid(s, t, linearBias, true);
    release(s);
    expect(s.source).toBe('linear');
    expect(readingM(s)).toBeCloseTo(0.625, 1);
  });

  it('can arm from linear-only samples after the press', () => {
    const s = initSlide();
    const bias = 0.12;
    let t = 0;
    anchor(s);
    for (let i = 0; i < 4; i += 1) {
      feed(s, { t, raw: null, linear: { x: 0, y: bias, z: 0 } });
      t += DT_MS;
    }
    const phases: Array<[number, number]> = [
      [15, 2],
      [60, 0],
      [15, -2],
      [8, 0],
    ];
    for (const [count, ay] of phases) {
      for (let i = 0; i < count; i += 1) {
        feed(s, { t, raw: null, linear: { x: 0, y: ay + bias, z: 0 } });
        t += DT_MS;
      }
    }
    release(s);
    expect(s.source).toBe('linear');
    expect(readingM(s)).toBeCloseTo(0.625, 1);
  });

  it('measures a gentle acceleration below the old gravity threshold', () => {
    const s = initSlide();
    let t = idle(s, 0);
    t = begin(s, t);
    t = push(s, t, 30, 0.5);
    t = push(s, t, 30, -0.5);
    t = push(s, t, 6, 0);
    release(s);
    // Two 0.5 s phases form a triangle velocity profile: ~0.125 m.
    expect(readingM(s)).toBeGreaterThan(0.1);
    expect(readingM(s)).toBeLessThan(0.15);
  });

  it('skips a large sensor gap rather than integrating it', () => {
    const s = initSlide();
    let t = idle(s, 0);
    t = begin(s, t);
    t = push(s, t, 8, 2);
    t += 1000;
    feed(s, sample(t, 2));
    const before = readingM(s);
    feed(s, sample(t + DT_MS, 2));
    expect(readingM(s) - before).toBeLessThan(0.02);
    expect(slideQuality(s)).toBe('uncertain');
  });

  it('marks an acceleration-only release as uncertain', () => {
    const s = initSlide();
    let t = idle(s, 0);
    t = begin(s, t);
    t = push(s, t, 30, 1);
    expect(readingM(s)).toBeGreaterThan(0.1);
    release(s);
    expect(slideQuality(s)).toBe('uncertain');
  });

  it('ignores null and non-finite samples', () => {
    const s = initSlide();
    anchor(s);
    feed(s, { t: 0, raw: null, linear: null });
    feed(s, { t: 16, raw: { x: 0, y: Number.NaN, z: -9.81 }, linear: null });
    expect(readingM(s)).toBe(0);
  });
});
