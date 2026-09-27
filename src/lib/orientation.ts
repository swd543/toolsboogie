/**
 * Device sensor abstractions: compass heading + level tilt.
 *
 * Handles the messy browser landscape:
 *  - iOS 13+ requires an explicit permission request for orientation and
 *    motion (must be triggered by a user gesture) — `requestSensorPermission`.
 *  - iOS reports a true `webkitCompassHeading`; other devices report the
 *    raw `alpha` (device tilt around the vertical axis), which is only a
 *    true heading when the device lies flat — we surface that as a
 *    "relative" vs "absolute" status and a tilt warning.
 *
 * The UI layer (routes) owns the signals; this module just wires listeners
 * and normalizes the data.
 */

export type SensorStatus =
  | 'unsupported' // no API at all
  | 'needs-permission' // iOS: awaiting the user-gesture request
  | 'denied'
  | 'active';

export interface HeadingReading {
  /** Heading in degrees 0..360 (0 = north, clockwise). */
  heading: number;
  /** True-heading when known; device-relative otherwise. */
  absolute: boolean;
  /** True when the device is held too tilted for a meaningful heading. */
  tilted: boolean;
}

export interface TiltReading {
  /** Front–back tilt in degrees (device flat face-up ≈ 0). */
  beta: number;
  /** Left–right tilt in degrees (device flat face-up ≈ 0). */
  gamma: number;
  /** Resulting tilt angle in degrees. */
  angle: number;
  /** Direction of the low side in degrees (0 = up edge, clockwise). */
  direction: number;
}

declare global {
  interface DeviceOrientationEvent {
    webkitCompassHeading?: number;
  }
  interface DeviceOrientationEvent {
    requestPermission?: () => Promise<'granted' | 'denied'>;
  }
  interface DeviceMotionEvent {
    requestPermission?: () => Promise<'granted' | 'denied'>;
  }
}

export function orientationApiAvailable(): boolean {
  return typeof DeviceOrientationEvent !== 'undefined';
}

export function motionApiAvailable(): boolean {
  // Tilt is read from deviceorientation (beta/gamma); the check is kept for
  // API presence parity with the compass side.
  return typeof DeviceOrientationEvent !== 'undefined' || typeof DeviceMotionEvent !== 'undefined';
}

/**
 * Request iOS sensor permissions (orientation + motion). Must be called
 * from a user gesture. Resolves 'granted' | 'denied'; on non-iOS browsers
 * there is nothing to request, so it resolves 'granted' immediately.
 */
export async function requestSensorPermission(): Promise<'granted' | 'denied'> {
  const doe = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  const dme = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
  try {
    if (typeof doe.requestPermission === 'function') {
      const r = await doe.requestPermission();
      if (r !== 'granted') return 'denied';
    }
    if (typeof dme.requestPermission === 'function') {
      const r = await dme.requestPermission();
      if (r !== 'granted') return 'denied';
    }
    return 'granted';
  } catch {
    return 'denied';
  }
}

/** Watch compass headings. Returns a cleanup function. */
export function watchHeading(
  onReading: (r: HeadingReading) => void,
  onStatus: (s: SensorStatus) => void,
): () => void {
  if (!orientationApiAvailable()) {
    onStatus('unsupported');
    return () => {};
  }
  let last = 0;
  const handler = (e: DeviceOrientationEvent) => {
    const now = performance.now();
    if (now - last < 33) return; // ~30 Hz cap
    last = now;

    const beta = e.beta ?? 0;
    const gamma = e.gamma ?? 0;
    // Tilt warning: heading is only meaningful when roughly face-up.
    const tilted = Math.hypot(beta, gamma) > 45;

    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
      onReading({ heading: e.webkitCompassHeading, absolute: true, tilted });
      return;
    }

    const alpha = e.alpha;
    if (alpha == null) return;
    // Flat, face-up: screen-relative alpha 0 ≈ device top edge → heading is
    // 360−alpha. Without the `absolute` flag this is relative to magnetic
    // north at best, and meaningless when tilted.
    onReading({
      heading: (360 - alpha + 360) % 360,
      absolute: e.absolute === true,
      tilted: tilted || !e.absolute,
    });
  };

  let gotEvent = false;
  const onFirst = () => {
    gotEvent = true;
  };
  window.addEventListener('deviceorientation', handler);
  window.addEventListener('deviceorientation', onFirst, { once: true });
  // Report active immediately; the UI shows "waiting for sensor" until the
  // first reading arrives (tracked by the caller via onReading calls).
  onStatus('active');
  return () => {
    window.removeEventListener('deviceorientation', handler);
    window.removeEventListener('deviceorientation', onFirst);
    void gotEvent;
  };
}

/**
 * Watch level tilt. Uses the `deviceorientation` event (beta/gamma), which
 * is where the platform exposes the gravity-referenced axes on all
 * browsers; `devicemotion` has no beta/gamma.
 */
export function watchTilt(
  onReading: (r: TiltReading) => void,
  onStatus: (s: SensorStatus) => void,
): () => void {
  if (!motionApiAvailable()) {
    onStatus('unsupported');
    return () => {};
  }
  let last = 0;
  const handler = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    const now = performance.now();
    if (now - last < 33) return;
    last = now;

    // Device held flat, face-up, top edge up: beta ≈ 0, gamma ≈ 0.
    const beta = e.beta;
    const gamma = e.gamma;
    const angle = Math.hypot(beta, gamma);
    const direction = ((Math.atan2(-beta, -gamma) * 180) / Math.PI + 360) % 360;
    onReading({ beta, gamma, angle, direction });
  };
  window.addEventListener('deviceorientation', handler);
  onStatus('active');
  return () => window.removeEventListener('deviceorientation', handler);
}
