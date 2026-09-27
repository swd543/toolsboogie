/**
 * Shared types for the tool features.
 *
 * Every feature follows the same shape: a pure `logic` module that takes
 * plain data + options and returns plain data (no DOM, no solid imports),
 * plus a thin UI layer that wires it to signals and DOM. Keeping the logic
 * pure makes it unit-testable in Node (the WASM-dependent bits get a
 * JS fallback path that the tests exercise).
 */

/** Error thrown when an operation cannot run because a subsystem is missing. */
export class CapabilityError extends Error {
  constructor(
    message: string,
    public readonly fallback?: string,
  ) {
    super(message);
    this.name = 'CapabilityError';
  }
}

/** Give the event loop a turn so long synchronous sections don't freeze
 *  the UI between progress updates. */
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel !== 'undefined') {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(null);
      return;
    }
    setTimeout(resolve, 0);
  });
}

/** Human-readable byte size (1 KB = 1024). */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes;
  let i = -1;
  do {
    v /= 1024;
    i += 1;
  } while (v >= 1024 && i < units.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}
