/**
 * Guitar tuner — microphone → AudioWorklet ring buffer (8192-sample
 * frames) → WASM YIN pitch detection. Live note, cents gauge, spectrum.
 *
 * The audio path is deliberately quiet: the analyser node is connected
 * through a zero-gain node, so nothing is played back. Audio never leaves
 * the device — it is analyzed in-page and discarded.
 */
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { AdSlot } from '~/components/AdSlot';
import { AlertIcon, MicIcon } from '~/components/Icons';
import { RouteMeta } from '~/components/RouteMeta';
import { ToolColumns, ToolPage } from '~/components/Shell';
import {
  centsLabel,
  isTuned,
  needleRotation,
  STANDARD_TUNING,
  type TunerState,
  workletUrl,
} from '~/features/tuner/logic';
import { toolcoreAvailable, wasmPitchDetect } from '~/lib/wasm';
import { expandAds } from '~/site/ads';

export default function GuitarTunerPage() {
  const [live, setLive] = createSignal(false);
  const [starting, setStarting] = createSignal(false);
  const [error, setError] = createSignal('');
  const [targetMidi, setTargetMidi] = createSignal(64); // E4 (high E)
  const [state, setState] = createSignal<TunerState | null>(null);
  const [spectrum, setSpectrum] = createSignal<number[]>([]);

  let ctx: AudioContext | null = null;
  let node: AudioWorkletNode | null = null;
  let silentGain: GainNode | null = null;
  let stream: MediaStream | null = null;
  let analyzing = false;

  const tuned = createMemo(() => {
    const s = state();
    return s !== null && isTuned(s, targetMidi());
  });
  const noteClass = createMemo(() => {
    const s = state();
    return s && s.midi >= 0 ? (tuned() ? 'is-tuned' : '') : 'is-muted';
  });
  const noteText = createMemo(() => {
    const s = state();
    return s ? (s.midi >= 0 ? s.note : '—') : '·';
  });
  const centsText = createMemo(() => {
    const s = state();
    return s ? centsLabel(s) : live() ? 'listening…' : 'start the mic to tune';
  });
  const freqText = createMemo(() => {
    const s = state();
    return s && s.midi >= 0 ? `${s.freq.toFixed(1)} Hz` : '';
  });
  const needleDeg = createMemo(() => {
    const s = state();
    return `${needleRotation(s?.cents ?? 0, s !== null && s.midi >= 0).toFixed(1)}deg`;
  });
  const stringTuned = (midi: number): boolean => {
    const s = state();
    return s !== null && isTuned(s, midi);
  };

  const stop = async () => {
    try {
      node?.disconnect();
      silentGain?.disconnect();
    } catch {
      /* already disconnected */
    }
    stream?.getTracks().forEach((t) => {
      t.stop();
    });
    try {
      await ctx?.close();
    } catch {
      /* already closed */
    }
    node = null;
    stream = null;
    ctx = null;
    silentGain = null;
    setLive(false);
    setState(null);
    setSpectrum([]);
  };

  const start = async () => {
    expandAds();
    setStarting(true);
    setError('');
    try {
      if (!(await toolcoreAvailable())) {
        throw new Error(
          'The tuner needs the WASM core, which is missing from this build. Run “pnpm wasm” (requires Rust) and rebuild.',
        );
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      ctx = new AudioContext();
      await ctx.audioWorklet.addModule(workletUrl(import.meta.env.BASE_URL));
      node = new AudioWorkletNode(ctx, 'frame-accumulator');
      const src = ctx.createMediaStreamSource(stream);
      silentGain = ctx.createGain();
      silentGain.gain.value = 0; // analysis only — nothing is played
      src.connect(node);
      node.connect(silentGain);
      silentGain.connect(ctx.destination);

      node.port.onmessage = async (e: MessageEvent) => {
        const data = e.data as { type?: string; samples?: Float32Array };
        if (data?.type !== 'frame' || !data.samples || analyzing) return;
        analyzing = true;
        try {
          const r = await wasmPitchDetect(data.samples, ctx?.sampleRate ?? 48000);
          setState({ midi: r.midi, note: r.note, cents: r.cents, freq: r.freq, rms: r.rms });
          setSpectrum(Array.from(r.spectrum));
        } catch {
          /* a bad frame — ignore */
        } finally {
          analyzing = false;
        }
      };
      setLive(true);
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow the microphone in your browser and try again.'
          : e instanceof Error
            ? e.message
            : String(e),
      );
      await stop();
    } finally {
      setStarting(false);
    }
  };

  onCleanup(() => {
    void stop();
  });

  const specBins = 48;

  return (
    <>
      <RouteMeta path="/guitar-tuner" />
      <ToolPage
        title="Guitar tuner"
        lede="Tap a string and watch the gauge. A YIN pitch detector runs on 8192-sample frames from your microphone — note, cents and frequency update live, and the spectrum shows what it hears. Nothing is recorded or sent anywhere."
        related={[
          { path: '/compass', label: 'Compass' },
          { path: '/level', label: 'Level' },
          { path: '/ruler', label: 'Ruler' },
        ]}
      >
        <div class="tuner-stage">
          <div class="tuner-main">
            <div class="gauge" data-tuned={tuned() ? 'true' : 'false'}>
              <svg class="gauge-face" viewBox="0 0 220 100" aria-hidden="true">
                <path
                  d="M110 92 A 84 84 0 0 1 26 48"
                  fill="none"
                  stroke="var(--line-strong)"
                  stroke-width="2"
                />
                <path
                  d="M110 92 A 84 84 0 0 0 194 48"
                  fill="none"
                  stroke="var(--line-strong)"
                  stroke-width="2"
                />
                <path
                  d="M110 92 A 84 84 0 0 0 103 8"
                  fill="none"
                  stroke="var(--ok)"
                  stroke-width="4"
                  stroke-linecap="round"
                  transform="rotate(8 110 92)"
                />
                <path
                  d="M110 92 A 84 84 0 0 1 117 8"
                  fill="none"
                  stroke="var(--ok)"
                  stroke-width="4"
                  stroke-linecap="round"
                  transform="rotate(-8 110 92)"
                />
                {[-45, -30, -15, 0, 15, 30, 45].map((a) => (
                  <g transform={`rotate(${a} 110 92)`}>
                    <line
                      x1="110"
                      y1="12"
                      x2="110"
                      y2={a === 0 ? 22 : 17}
                      stroke="var(--ink-muted)"
                      stroke-width={a === 0 ? 3 : 1.5}
                    />
                  </g>
                ))}
              </svg>
              <div class="gauge-needle" style={{ '--gauge-rot': needleDeg() } as any} />
              <div class="gauge-hub" />
            </div>
            <div class="tuner-readout">
              <div class={`tuner-note ${noteClass()}`}>{noteText()}</div>
              <div class={`tuner-cents ${tuned() ? 'is-tuned' : ''}`}>{centsText()}</div>
              <Show when={freqText() !== ''}>
                <div class="tuner-freq">{freqText()}</div>
              </Show>
            </div>
          </div>

          <aside class="tool-aside" style="margin: 0">
            <button
              type="button"
              class="btn btn-primary btn-block"
              onClick={() => void start()}
              disabled={live() || starting()}
            >
              <MicIcon /> {starting() ? 'Starting…' : 'Start microphone'}
            </button>
            <Show when={live()}>
              <button type="button" class="btn btn-ghost btn-block" onClick={() => void stop()}>
                Stop
              </button>
            </Show>
            <div class="mic-status" data-live={live() ? 'true' : 'false'}>
              <span class="dot" />
              {live() ? 'listening — analysis is silent (0 dB out)' : 'microphone idle'}
            </div>
            <Show when={error() !== ''}>
              <div class="error-card" style="margin-top: 0.75rem">
                <AlertIcon />
                <p>{error()}</p>
              </div>
            </Show>
          </aside>
        </div>

        <div class="spectrum-wrap">
          <div class="spectrum" role="img" aria-label="Live spectrum">
            <For each={Array.from({ length: specBins }, (_, i) => i)}>
              {(i) => (
                <div
                  class="spec-bar"
                  style={{ height: `${Math.round((spectrum()[i] ?? 0) * 100)}%` }}
                />
              )}
            </For>
          </div>
        </div>

        <div class="tuner-string-row">
          <For each={STANDARD_TUNING}>
            {(s) => (
              <button
                type="button"
                class={`tuner-string ${targetMidi() === s.midi ? 'active' : ''}`}
                data-tuned={stringTuned(s.midi) ? 'true' : 'false'}
                onClick={() => setTargetMidi(s.midi)}
              >
                {s.label}
              </button>
            )}
          </For>
        </div>

        <ToolColumns
          aside={
            <div class="opt-group">
              <span class="opt-label">Tuning tips</span>
              <p class="opt-hint">
                Tap the string, let it ring, and watch the needle: left = flat (↓), right = sharp
                (↑). Green means within ±5¢ of the selected string.
              </p>
              <p class="opt-hint">
                Low E (82 Hz) needs a clear ring — a quiet room helps. If the note reads an octave
                off, the string was probably heard through its 2nd harmonic; re-tap and listen to
                the cents.
              </p>
            </div>
          }
        >
          <AdSlot slot="tool-bottom" />
        </ToolColumns>
      </ToolPage>
    </>
  );
}
