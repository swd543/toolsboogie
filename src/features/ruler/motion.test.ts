import { describe, expect, it } from 'vitest';
import {
  anchor,
  feed,
  initSlide,
  type MotionSample,
  readingM,
  release,
  resetReading,
} from './motion';

/** Build a sample stream: gravity on -Z, plus a Y acceleration profile. */
function stream(samples: { t: number; ay: number }[], withLinear: boolean): MotionSample[] {
  return samples.map(({ t, ay }) =>
    withLinear
      ? { t, raw: { x: 0, y: ay, z: -9.81 }, linear: { x: 0, y: ay, z: 0 } }
      : { t, raw: { x: 0, y: ay, z: -9.81 }, linear: null },
  );
}

describe('slide anchor/release', () => {
  it('feeds before an anchor do nothing', () => {
    const s = initSlide();
    for (const m of stream(
      [0, 16, 32].map((t) => ({ t, ay: 2 })),
      true,
    ))
      feed(s, m);
    expect(readingM(s)).toBe(0);
    expect(s.anchored).toBe(false);
  });

  it('anchor starts at zero; release freezes the reading', () => {
    const s = initSlide();
    anchor(s);
    expect(readingM(s)).toBe(0);
    // 10 at-rest samples seed the gravity estimate, then a push at 2 m/s².
    for (let i = 0; i < 40; i += 1) {
      const tt = i * 16;
      feed(s, { t: tt, raw: { x: 0, y: i < 10 ? 0 : 2, z: -9.81 }, linear: null });
    }
    const held = readingM(s);
    expect(held).toBeGreaterThan(0.1);
    release(s);
    // Further samples after release must not move the reading.
    for (let i = 0; i < 20; i += 1)
      feed(s, { t: 500 + i * 16, raw: { x: 0, y: 2, z: -9.81 }, linear: null });
    expect(readingM(s)).toBeCloseTo(held, 10);
  });

  it('re-anchoring resets the reading to zero', () => {
    const s = initSlide();
    anchor(s);
    for (let i = 0; i < 40; i += 1) {
      const tt = i * 16;
      feed(s, { t: tt, raw: { x: 0, y: i < 10 ? 0 : 2, z: -9.81 }, linear: null });
    }
    expect(readingM(s)).toBeGreaterThan(0.1);
    release(s);
    anchor(s);
    expect(readingM(s)).toBe(0);
  });

  it('reset zeros the reading without anchoring', () => {
    const s = initSlide();
    anchor(s);
    for (let i = 0; i < 40; i += 1) {
      const tt = i * 16;
      feed(s, { t: tt, raw: { x: 0, y: i < 10 ? 0 : 2, z: -9.81 }, linear: null });
    }
    release(s);
    resetReading(s);
    expect(readingM(s)).toBe(0);
  });
});

describe('gravity + integration', () => {
  it('a resting phone reads ~0 (gravity removed)', () => {
    const s = initSlide();
    anchor(s);
    // 2 s of stillness at 60 Hz: raw signal is gravity only.
    const t = Array.from({ length: 120 }, (_, i) => i * 16.7);
    for (const tt of t) feed(s, { t: tt, raw: { x: 0, y: 0, z: -9.81 }, linear: null });
    expect(readingM(s)).toBeLessThan(0.005); // < 5 mm drift over 2 s at rest
  });

  it('a trapezoid slide reads roughly the travelled distance', () => {
    // Ramp up 2 m/s² for 0.25 s, cruise, ramp down: peak v = 0.5 m/s,
    // ideal distance = 0.5 * (0.25 + 1.0 + 0.25) = 0.625 m.
    const profile: { t: number; ay: number }[] = [];
    const dt = 16.7;
    let t = 0;
    const push = (n: number, ay: number) => {
      for (let i = 0; i < n; i += 1) {
        profile.push({ t, ay });
        t += dt;
      }
    };
    push(15, 2); // ~0.25 s
    push(60, 0); // ~1.0 s cruise
    push(15, -2); // ~0.25 s
    const s = initSlide();
    anchor(s);
    // Seed at rest, then the profile.
    for (const i of [0, 16.7, 33.4]) feed(s, { t: i, raw: { x: 0, y: 0, z: -9.81 }, linear: null });
    for (const m of stream(profile, false)) feed(s, m);
    release(s);
    const r = readingM(s);
    expect(r).toBeGreaterThan(0.5);
    expect(r).toBeLessThan(0.75);
  });

  it('uses the platform linear acceleration when provided', () => {
    const s = initSlide();
    anchor(s);
    const t = Array.from({ length: 40 }, (_, i) => i * 16.7);
    // raw carries gravity only; the linear channel carries the 2 m/s² slide.
    for (const tt of t)
      feed(s, { t: tt, raw: { x: 0, y: 0, z: -9.81 }, linear: { x: 0, y: 2, z: 0 } });
    // 0.67 s at 2 m/s² -> ~0.45 m (half of a*t²=0.449).
    expect(readingM(s)).toBeGreaterThan(0.35);
    expect(readingM(s)).toBeLessThan(0.55);
  });

  it('a slow steady slide is fully measured (not absorbed into gravity)', () => {
    // 0.5 m/s^2 is BELOW the rest threshold: before the anchor freeze it
    // was re-classified as gravity and the reading went to zero.
    const s = initSlide();
    let t = 0;
    for (let i = 0; i < 60; i += 1) {
      feed(s, { t, raw: { x: 0, y: 0, z: -9.81 }, linear: null });
      t += 16.7;
    }
    anchor(s);
    for (let i = 0; i < 30; i += 1) {
      feed(s, { t, raw: { x: 0, y: 0.5, z: -9.81 }, linear: null });
      t += 16.7;
    }
    const got = readingM(s);
    const ideal = 0.5 * 0.5 * 0.25; // 0.5 m/s^2 x 0.5 s
    expect(got).toBeGreaterThan(0.045);
    expect(got).toBeLessThan(ideal * 1.15);
  });

  it('clamps huge sample gaps instead of integrating them', () => {
    const s = initSlide();
    anchor(s);
    feed(s, { t: 0, raw: { x: 0, y: 2, z: -9.81 }, linear: null });
    feed(s, { t: 1000, raw: { x: 0, y: 2, z: -9.81 }, linear: null }); // 1 s gap
    feed(s, { t: 1016, raw: { x: 0, y: 2, z: -9.81 }, linear: null });
    // A 1 s gap must integrate at most DT_MAX (0.05 s) of acceleration.
    expect(readingM(s)).toBeLessThan(0.05 * 2);
  });

  it('ignores null/NaN samples', () => {
    const s = initSlide();
    anchor(s);
    feed(s, { t: 0, raw: null, linear: null });
    feed(s, { t: 16, raw: { x: NaN, y: 2, z: -9.81 }, linear: null });
    expect(readingM(s)).toBe(0);
  });
});
