/**
 * The dedicated format validators (shared by the five /<format>-validator
 * pages).
 *
 * One input, one format, an instant verdict: a live parse check while you
 * type, and a Validate action that reports the structure ("object · 5
 * keys") or the exact parser error. No conversion, no upload.
 */
import { createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { AdSlot } from '~/components/AdSlot';
import { CopyIcon, SpinnerIcon } from '~/components/Icons';
import { CodePanel, ToolColumns, ToolPage } from '~/components/Shell';
import {
  coreUnavailableMessage,
  formatById,
  SAMPLES,
  validate,
  validateSummary,
} from '~/features/convert/logic';
import { copyText } from '~/lib/clipboard';
import type { DataFormat } from '~/lib/wasm';

/** Per-format copy: lede + an honest one-liner about the format's limits. */
const COPY: Record<DataFormat, { lede: string; note: string }> = {
  json: {
    lede: 'Paste JSON and get an instant verdict - a structure summary when it parses, the exact parser error when it does not. Nothing is uploaded.',
    note: 'Full fidelity: numbers, strings, booleans, nulls, arrays, any depth.',
  },
  yaml: {
    lede: 'Paste YAML and check it - indentation, anchors and merge keys resolved - before it hits a CI job or an import. Nothing is uploaded.',
    note: 'Anchors and merge keys are resolved on the check; one document at a time - multi-document streams are rejected.',
  },
  toml: {
    lede: 'Paste TOML and check it - strict types, table headers and dates - with the exact parser error when it is not valid. Nothing is uploaded.',
    note: 'One document, table-style, strict types. TOML has no null value - nulls are a parse error here.',
  },
  ini: {
    lede: 'Paste an INI file and check it - [sections], key=value pairs, the exact parser error when it is not valid. Nothing is uploaded.',
    note: 'Classic [section] key=value files. Values are stored as text; one level of sections.',
  },
  xml: {
    lede: 'Paste XML and check it - well-formedness, matched tags, the single-root rule - with the exact parser error when it is not valid. Nothing is uploaded.',
    note: 'Needs a single root. When converting, the xml2js convention maps @-prefixed attributes and #text.',
  },
};

interface Props {
  /** The format this page validates. */
  format: DataFormat;
}

export function ValidatorPage(props: Props) {
  // The registry entry drives the labels ("JSON", "YAML", …).
  const def = () => formatById(props.format)!;

  const [input, setInput] = createSignal(SAMPLES[props.format]);
  const [valid, setValid] = createSignal(''); // '' = unknown, 'ok', or message
  const [output, setOutput] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [copied, setCopied] = createSignal(false);

  const name = () => def().name;

  /* Live status: debounced parse check of the input as this format. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scheduleStatus = () => {
    clearTimeout(timer);
    const text = input();
    if (!text.trim()) {
      setValid('');
      return;
    }
    timer = setTimeout(() => {
      void validate(text, props.format)
        .then(() => setValid('ok'))
        .catch((e) =>
          setValid(coreUnavailableMessage(e) ?? (e instanceof Error ? e.message : String(e))),
        );
    }, 250);
  };
  onCleanup(() => clearTimeout(timer));
  onMount(() => scheduleStatus());

  /** Parse-check the input and show the verdict in the result panel. */
  const runValidate = async () => {
    if (!input().trim()) {
      setError('Paste some data first (or load the sample).');
      setOutput('');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await validateSummary(input(), props.format);
      setOutput(r.ok ? `✓ Valid ${name()} - ${r.detail}` : `✗ ${r.detail}`);
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
    if (valid() === 'ok') return `valid ${name().toLowerCase()}`;
    if (valid() === '') return 'checking…';
    return 'invalid';
  });

  const other = (['json', 'yaml', 'toml', 'ini', 'xml'] as DataFormat[]).filter(
    (f) => f !== props.format,
  );

  return (
    <ToolPage
      tone="dev"
      title={`${name()} Validator`}
      lede={COPY[props.format].lede}
      related={[
        { path: '/convert', label: 'Data converter (all five formats)', group: 'Convert' },
        ...other.map((f) => ({
          path: `/${f}-validator`,
          label:
            f === 'json'
              ? 'JSON validator'
              : f === 'yaml'
                ? 'YAML validator'
                : f === 'toml'
                  ? 'TOML validator'
                  : f === 'ini'
                    ? 'INI validator'
                    : 'XML validator',
          group: 'Other validators',
        })),
      ]}
    >
      <Show when={error() !== ''} fallback={null}>
        <div class="error-card">
          <div>
            <b>Paste some data first</b>
            <p>{error()}</p>
          </div>
        </div>
      </Show>
      <ToolColumns
        aside={
          <>
            <div class="opt-group">
              <span class="opt-label">About {name()}</span>
              <p class="opt-hint">{COPY[props.format].note}</p>
            </div>
            <div class="opt-group">
              <span class="opt-label">Need another format?</span>
              <p class="opt-hint">
                The <a href="/convert/">data converter</a> turns {name().toLowerCase()} into JSON,
                YAML, TOML, INI or XML.
              </p>
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
            scheduleStatus();
          }}
          hasError={valid() !== 'ok' && valid() !== ''}
          stat={statusText() || undefined}
          actions={
            <span class="code-actions">
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                onClick={() => setInput(SAMPLES[props.format])}
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
          <button type="button" class="btn btn-primary" onClick={runValidate} disabled={busy()}>
            {busy() ? <SpinnerIcon /> : null}
            Validate {name()}
          </button>
          <AdSlot slot="tool-bottom" />
        </div>
        <Show when={output() !== ''}>
          <CodePanel
            label="Result"
            value={output()}
            readOnly
            hasError={output().startsWith('✗')}
            stat="parse check only - no conversion"
            actions={
              <span class="code-actions">
                <button type="button" class="btn btn-sm btn-ghost" onClick={copyOut}>
                  <CopyIcon /> {copied() ? 'Copied ✓' : 'Copy'}
                </button>
              </span>
            }
          />
        </Show>
      </ToolColumns>
    </ToolPage>
  );
}
