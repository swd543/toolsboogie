/**
 * The data converter page (shared by /convert and the 20 per-path URLs).
 *
 * One input, five source formats (auto-detected by default), five targets,
 * per-target options (JSON indent, YAML anchors, XML minify, sort keys
 * everywhere, and a null policy for the formats without null), and a
 * parse-only Validate action. Each path page prefills its own sample in its
 * source format.
 */
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { AdSlot } from '~/components/AdSlot';
import { AlertIcon, CopyIcon, DownloadIcon, SpinnerIcon } from '~/components/Icons';
import { CodePanel, ToolColumns, ToolPage } from '~/components/Shell';
import {
  convert,
  coreUnavailableMessage,
  FORMATS,
  type FormatDef,
  formatById,
  formatPairs,
  sampleFor,
  validate,
  validateSummary,
} from '~/features/convert/logic';
import { copyText } from '~/lib/clipboard';
import { saveText } from '~/lib/download';
import { humanSize } from '~/lib/types';
import { type DataFormat, type NullPolicy, wasmDetectFormat } from '~/lib/wasm';
import { expandAds } from '~/site/ads';

const AUTO: DataFormat | 'auto' = 'auto';

interface Props {
  /** Page heading: "Data converter" or "JSON to YAML". */
  title: string;
  /** Preset source format ('auto' = detect), used by the per-path pages. */
  from: DataFormat | 'auto';
  /** Preset target format. */
  to: DataFormat;
}

export function ConverterPage(props: Props) {
  // Prefill the input with a sample written in the page's own source format.
  const [input, setInput] = createSignal(sampleFor(props.from));
  const [fromSel, setFromSel] = createSignal<DataFormat | 'auto'>(props.from);
  const [toSel, setToSel] = createSignal<DataFormat>(props.to);
  const [indent, setIndent] = createSignal(2);
  const [sortKeys, setSortKeys] = createSignal(false);
  const [anchors, setAnchors] = createSignal(true);
  const [minify, setMinify] = createSignal(false);
  const [nullPolicy, setNullPolicy] = createSignal<NullPolicy>('fail');

  /** 'convert' = normal output, 'validate' = parse-check result line. */
  const [resultKind, setResultKind] = createSignal<'convert' | 'validate'>('convert');

  const [output, setOutput] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  const [detected, setDetected] = createSignal('');
  const [valid, setValid] = createSignal(''); // '' = unknown, 'ok', or message

  const toDef = createMemo<FormatDef>(() => formatById(toSel())!);
  const effectiveFrom = createMemo<DataFormat>(() => {
    const d = detected();
    return fromSel() === AUTO
      ? formatById(d)
        ? (d as DataFormat)
        : 'json'
      : (fromSel() as DataFormat);
  });

  /* Live status: debounced format detection + validation of the input. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  let statusGen = 0;
  const scheduleStatus = () => {
    clearTimeout(timer);
    const gen = ++statusGen;
    const text = input();
    if (!text.trim()) {
      setDetected('');
      setValid('');
      return;
    }
    timer = setTimeout(() => {
      void (async () => {
        // Detect first, then validate against the detected format. The old
        // flow validated against the stale detection (or the json fallback)
        // in the same tick and reported "invalid" for input that was valid
        // in its own format - while the Convert action (which re-detects)
        // succeeded, so the status and the action disagreed.
        let src: DataFormat;
        if (fromSel() === AUTO) {
          const d = await wasmDetectFormat(text).catch(() => '');
          if (gen !== statusGen) return; // superseded by newer input
          setDetected(d);
          src = d !== '' ? (d as DataFormat) : 'json';
        } else {
          setDetected('');
          src = fromSel() as DataFormat;
        }
        try {
          await validate(text, src);
          if (gen !== statusGen) return;
          setValid('ok');
        } catch (e) {
          if (gen !== statusGen) return;
          setValid(coreUnavailableMessage(e) ?? (e instanceof Error ? e.message : String(e)));
        }
      })();
    }, 250);
  };
  onCleanup(() => clearTimeout(timer));
  // Validate/detect the prefilled sample right after mount (SSR does not
  // run the debounced status loop).
  onMount(() => scheduleStatus());

  // SPA navigation between the 20 path pages updates the props without a
  // remount; re-sync the state so each path starts with its own preset
  // pair and its own sample.
  createEffect(() => {
    const from = props.from;
    const to = props.to;
    setFromSel(from);
    setToSel(to);
    setInput(sampleFor(from));
    setOutput('');
    setError('');
    setResultKind('convert');
    setDetected('');
    setValid('');
    // untrack: scheduleStatus reads the input signal; without this the
    // effect would re-run on every keystroke and reset the input to the
    // sample.
    untrack(() => scheduleStatus());
  });

  const run = async () => {
    if (!input().trim()) {
      setError('Paste some data first (or load the sample).');
      setOutput('');
      return;
    }
    expandAds();
    setBusy(true);
    setError('');
    setResultKind('convert');
    try {
      const r = await convert(input(), fromSel(), toSel(), {
        indent: toSel() === 'json' ? indent() : undefined,
        sortKeys: sortKeys(),
        anchors: toSel() === 'yaml' ? anchors() : undefined,
        minify: toSel() === 'xml' ? minify() : undefined,
        nullPolicy:
          toSel() === 'toml' || toSel() === 'ini' || toSel() === 'xml' ? nullPolicy() : undefined,
      });
      setOutput(r.output);
      if (r.detected) {
        setDetected(r.from);
      }
      // The input parsed: a stale 'invalid' from the live check is settled.
      setValid('ok');
    } catch (e) {
      setOutput('');
      const msg = coreUnavailableMessage(e) ?? (e instanceof Error ? e.message : String(e));
      setError(msg);
      // Keep the live status and the error card in agreement on parse
      // failures (render failures like the null policy leave validity as-is).
      if (msg.startsWith('Invalid') || msg.startsWith('Could not detect')) {
        setValid(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  /** Sample/Clear change the input programmatically - the onInput handler
   *  does not fire, so the live status must be (re)scheduled explicitly. */
  const loadSample = () => {
    setInput(sampleFor(fromSel()));
    scheduleStatus();
  };
  const clearInput = () => {
    setInput('');
    scheduleStatus();
  };

  /** Parse-check the input (no conversion) and show the result in the output panel. */
  const runValidate = async () => {
    if (!input().trim()) {
      setError('Paste some data first (or load the sample).');
      setOutput('');
      return;
    }
    setBusy(true);
    setError('');
    setResultKind('validate');
    try {
      const r = await validateSummary(input(), fromSel());
      setOutput(
        r.ok
          ? `✓ Valid ${formatById(r.format ?? 'json')?.label ?? r.format} - ${r.detail}`
          : `✗ ${r.detail}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const copyOut = async () => {
    if (await copyText(output())) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const statusText = createMemo(() => {
    if (!input().trim()) return '';
    if (valid() === 'ok') {
      const d = detected();
      return fromSel() === AUTO
        ? d
          ? `detected as ${formatById(d)?.label ?? d} - looks valid`
          : 'checking format\u2026'
        : `valid ${formatById(fromSel())?.label ?? fromSel()}`;
    }
    if (valid() === '') return 'checking\u2026';
    return 'invalid';
  });

  const pairs = formatPairs();

  return (
    <ToolPage
      tone="dev"
      title={props.title}
      lede="Convert between JSON, YAML, TOML, INI and XML - format, validate and reshape data without leaving your browser. Nothing is uploaded."
      related={[
        ...pairs.map((p) => ({
          path: `/convert/${p.slug}`,
          label: `${formatById(p.from)!.label} → ${formatById(p.to)!.label}`,
          group: 'Conversion paths',
        })),
        { path: '/validators', label: 'Data validator (all formats)', group: 'Validators' },
        { path: '/regex', label: 'Regex checker', group: 'More tools' },
        { path: '/string-escape', label: 'String escaper', group: 'More tools' },
      ]}
    >
      <Show when={error() !== ''} fallback={null}>
        <div class="error-card">
          <AlertIcon />
          <div>
            <b>Could not convert</b>
            <p>{error()}</p>
          </div>
        </div>
      </Show>
      <ToolColumns
        aside={
          <>
            <div class="opt-group">
              <span class="opt-label">Source format</span>
              <div class="field">
                <span>From</span>
                <select
                  value={fromSel()}
                  ref={(el) => {
                    el.value = fromSel(); // SSR select values are content-model driven
                  }}
                  onChange={(e) => {
                    setFromSel(e.currentTarget.value as DataFormat | 'auto');
                    scheduleStatus();
                  }}
                >
                  <option value="auto">Auto-detect</option>
                  {FORMATS.map((f) => (
                    <option value={f.id}>{f.label}</option>
                  ))}
                </select>
              </div>
              <div class="field">
                <span>To</span>
                <select
                  value={toSel()}
                  ref={(el) => {
                    el.value = toSel();
                  }}
                  onChange={(e) => setToSel(e.currentTarget.value as DataFormat)}
                >
                  {FORMATS.map((f) => (
                    <option value={f.id}>{f.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div class="opt-group">
              <span class="opt-label">Output options</span>
              <Show when={toSel() === 'json'}>
                <div class="field">
                  <span>Indent</span>
                  <select
                    value={String(indent())}
                    ref={(el) => {
                      el.value = String(indent());
                    }}
                    onChange={(e) => setIndent(Number(e.currentTarget.value))}
                  >
                    <option value="0">minify</option>
                    <option value="2">2 spaces</option>
                    <option value="4">4 spaces</option>
                    <option value="8">8 spaces</option>
                  </select>
                </div>
              </Show>
              <Show when={toSel() === 'yaml'}>
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={anchors()}
                    onChange={(e) => setAnchors(e.currentTarget.checked)}
                  />
                  <span class="knob" />
                  <span class="toggle-text">Anchors for repeated blocks</span>
                </label>
                <p class="opt-hint">
                  Repeated mappings and arrays become <code>&amp;anchor</code> / <code>*alias</code>
                  , and a mapping that is an earlier block plus extra keys gets a{' '}
                  <code>&lt;&lt;: *anchor</code> merge - whatever can be merged, is.
                </p>
              </Show>
              <Show when={toSel() === 'xml'}>
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={minify()}
                    onChange={(e) => setMinify(e.currentTarget.checked)}
                  />
                  <span class="knob" />
                  <span class="toggle-text">Minify (one line)</span>
                </label>
                <p class="opt-hint">
                  Compress the document to a single line - same content, no indentation or newlines.
                </p>
              </Show>
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={sortKeys()}
                  onChange={(e) => setSortKeys(e.currentTarget.checked)}
                />
                <span class="knob" />
                <span class="toggle-text">Sort keys</span>
              </label>
              <Show when={toSel() === 'toml' || toSel() === 'ini' || toSel() === 'xml'}>
                <div class="field">
                  <span>Nulls</span>
                  <select
                    value={nullPolicy()}
                    ref={(el) => {
                      el.value = nullPolicy();
                    }}
                    onChange={(e) => setNullPolicy(e.currentTarget.value as NullPolicy)}
                  >
                    <option value="fail">Fail with key paths</option>
                    <option value="skip">Skip the key</option>
                    <option value="emptyString">Empty string</option>
                  </select>
                </div>
                <p class="opt-hint">
                  {toDef().label} has no null value - pick what happens to nulls.
                </p>
              </Show>
            </div>
            <div class="opt-group">
              <span class="opt-label">About {toDef().label}</span>
              <p class="opt-hint">{toDef().note}</p>
            </div>
          </>
        }
      >
        <CodePanel
          label="Input"
          value={input()}
          onInput={(v) => {
            setInput(v);
            setValid('');
            setDetected('');
            scheduleStatus();
          }}
          hasError={valid() !== 'ok' && valid() !== ''}
          stat={statusText() || undefined}
          actions={
            <span class="code-actions">
              <button type="button" class="btn btn-sm btn-ghost" onClick={loadSample}>
                Sample
              </button>
              <button type="button" class="btn btn-sm btn-ghost" onClick={clearInput}>
                Clear
              </button>
            </span>
          }
        />
        <div class="cta">
          <button type="button" class="btn btn-primary" onClick={run} disabled={busy()}>
            {busy() ? <SpinnerIcon /> : null}
            Convert to {toDef().label}
          </button>
          <button type="button" class="btn" onClick={runValidate} disabled={busy()}>
            Validate
          </button>
          <AdSlot slot="tool-bottom" />
        </div>
        <Show when={output() !== ''}>
          <CodePanel
            label={resultKind() === 'validate' ? 'Validation' : `${toDef().label} output`}
            value={output()}
            readOnly
            hasError={resultKind() === 'validate' && output().startsWith('✗')}
            stat={
              resultKind() === 'validate'
                ? 'parse check only - no conversion'
                : `${humanSize(output().length)} · via ${formatById(effectiveFrom())?.label ?? effectiveFrom()}`
            }
            actions={
              <span class="code-actions">
                <button type="button" class="btn btn-sm btn-ghost" onClick={copyOut}>
                  <CopyIcon /> {copied() ? 'Copied ✓' : 'Copy'}
                </button>
                {resultKind() === 'convert' ? (
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost"
                    onClick={() => saveText(output(), `converted.${toDef().ext}`, toDef().mime)}
                  >
                    <DownloadIcon /> Download
                  </button>
                ) : null}
              </span>
            }
          />
        </Show>
      </ToolColumns>
    </ToolPage>
  );
}
