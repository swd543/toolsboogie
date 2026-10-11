/**
 * The data converter page (shared by /convert and the 20 per-path URLs).
 *
 * One input, five source formats (auto-detected by default), five targets,
 * and per-target options: JSON indent, YAML anchors, sort keys everywhere,
 * and a null policy for the formats that have no null.
 */
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
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
  SAMPLE_INPUT,
  validate,
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
  const [input, setInput] = createSignal(SAMPLE_INPUT);
  const [fromSel, setFromSel] = createSignal<DataFormat | 'auto'>(props.from);
  const [toSel, setToSel] = createSignal<DataFormat>(props.to);
  const [indent, setIndent] = createSignal(2);
  const [sortKeys, setSortKeys] = createSignal(false);
  const [anchors, setAnchors] = createSignal(true);
  const [nullPolicy, setNullPolicy] = createSignal<NullPolicy>('fail');

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
  const scheduleStatus = () => {
    clearTimeout(timer);
    const text = input();
    if (!text.trim()) {
      setDetected('');
      setValid('');
      return;
    }
    timer = setTimeout(() => {
      if (fromSel() === AUTO) {
        void wasmDetectFormat(text)
          .catch(() => '')
          .then((d) => setDetected(d));
      } else {
        setDetected('');
      }
      const src = fromSel() === AUTO ? detected() || 'json' : fromSel();
      void validate(text, src as DataFormat)
        .then(() => setValid('ok'))
        .catch((e) =>
          setValid(coreUnavailableMessage(e) ?? (e instanceof Error ? e.message : String(e))),
        );
    }, 250);
  };
  onCleanup(() => clearTimeout(timer));
  // Validate/detect the prefilled sample right after mount (SSR does not
  // run the debounced status loop).
  onMount(() => scheduleStatus());

  const run = async () => {
    if (!input().trim()) {
      setError('Paste some data first (or load the sample).');
      setOutput('');
      return;
    }
    expandAds();
    setBusy(true);
    setError('');
    try {
      const r = await convert(input(), fromSel(), toSel(), {
        indent: toSel() === 'json' ? indent() : undefined,
        sortKeys: sortKeys(),
        anchors: toSel() === 'yaml' ? anchors() : undefined,
        nullPolicy:
          toSel() === 'toml' || toSel() === 'ini' || toSel() === 'xml' ? nullPolicy() : undefined,
      });
      setOutput(r.output);
      if (r.detected) {
        setDetected(r.from);
      }
    } catch (e) {
      setOutput('');
      setError(coreUnavailableMessage(e) ?? (e instanceof Error ? e.message : String(e)));
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
        { path: '/regex', label: 'Regex checker' },
        { path: '/string-escape', label: 'String escaper' },
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
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                onClick={() => setInput(SAMPLE_INPUT)}
              >
                Sample
              </button>
              <button type="button" class="btn btn-sm btn-ghost" onClick={() => setInput('')}>
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
          <AdSlot slot="tool-bottom" />
        </div>
        <Show when={output() !== ''}>
          <CodePanel
            label={`${toDef().label} output`}
            value={output()}
            readOnly
            stat={`${humanSize(output().length)} · via ${formatById(effectiveFrom())?.label ?? effectiveFrom()}`}
            actions={
              <span class="code-actions">
                <button type="button" class="btn btn-sm btn-ghost" onClick={copyOut}>
                  <CopyIcon /> {copied() ? 'Copied ✓' : 'Copy'}
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  onClick={() => saveText(output(), `converted.${toDef().ext}`, toDef().mime)}
                >
                  <DownloadIcon /> Download
                </button>
              </span>
            }
          />
        </Show>
        <div class="convert-paths">
          <h2>Every conversion path</h2>
          <p class="convert-paths-hint">
            Each path has its own page, ready to share - the converter loads with that pair preset.
          </p>
          <ul>
            {pairs.map((p) => (
              <li>
                <a href={`/convert/${p.slug}`}>
                  {formatById(p.from)!.label} → {formatById(p.to)!.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </ToolColumns>
    </ToolPage>
  );
}
