/**
 * String escaper / unescaper — common variants, both directions, live.
 */
import { createMemo, createSignal, For, Show } from 'solid-js';
import { AdSlot } from '~/components/AdSlot';
import { AlertIcon, CopyIcon, RefreshIcon } from '~/components/Icons';
import { RouteMeta } from '~/components/RouteMeta';
import { CodePanel, ToolColumns, ToolPage } from '~/components/Shell';
import { VARIANTS, variant } from '~/features/escape/logic';
import { copyText } from '~/lib/clipboard';
import { humanSize } from '~/lib/types';

type Direction = 'escape' | 'unescape';

const SAMPLE: Record<string, string> = {
  json: 'He said "hello \\n world"',
  js: 'tab\tand "quotes"',
  java: 'a \u0041 b',
  c: 'bell \x07 sound',
  python: "it's fine",
  rust: '"quoted" text',
  html: 'a < b & c',
  'url-component': 'search?q=boogie & fun',
  'url-path': 'path with spaces & symbols',
  unicode: 'héllo ✓ 𝟝',
  shell: "it's an & argument",
  sql: "O'Neil's data",
};

export default function StringEscapePage() {
  const [variantId, setVariantId] = createSignal('json');
  const [dir, setDir] = createSignal<Direction>('escape');
  const [input, setInput] = createSignal<string>(SAMPLE.json ?? '');
  const [copied, setCopied] = createSignal(false);

  const active = createMemo(() => variant(variantId()));
  const output = createMemo(() => {
    if (!input()) return '';
    try {
      return dir() === 'escape' ? active().escape(input()) : active().unescape(input());
    } catch {
      return '';
    }
  });
  const error = createMemo(() => {
    if (!input()) return '';
    try {
      if (dir() === 'escape') active().escape(input());
      else active().unescape(input());
      return '';
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  });

  const pickVariant = (id: string) => {
    setVariantId(id);
    setInput(SAMPLE[id] ?? input());
  };

  const copyOut = async () => {
    if (await copyText(output())) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <>
      <RouteMeta path="/string-escape" />
      <ToolPage
        tone="dev"
        title="String escape & unescape"
        lede="Turn raw text into a safe form for JSON, JavaScript, C, HTML, shell, URLs and more — or read an escaped string back to plain text. Instant, local, nothing uploaded."
        related={[
          { path: '/json-format', label: 'JSON format' },
          { path: '/regex', label: 'Regex checker' },
          { path: '/time', label: 'Date & time' },
        ]}
      >
        <div class="tabs" role="tablist" aria-label="Direction">
          <button
            type="button"
            class={`tab ${dir() === 'escape' ? 'active' : ''}`}
            role="tab"
            aria-selected={dir() === 'escape'}
            onClick={() => setDir('escape')}
          >
            Escape
          </button>
          <button
            type="button"
            class={`tab ${dir() === 'unescape' ? 'active' : ''}`}
            role="tab"
            aria-selected={dir() === 'unescape'}
            onClick={() => setDir('unescape')}
          >
            Unescape
          </button>
        </div>
        <ToolColumns
          aside={
            <div class="opt-group">
              <span class="opt-label">Variant</span>
              <div class="field">
                <select value={variantId()} onChange={(e) => pickVariant(e.currentTarget.value)}>
                  <For each={VARIANTS}>{(v) => <option value={v.id}>{v.label}</option>}</For>
                </select>
              </div>
              <p class="opt-hint">{active().note}</p>
              <p class="opt-hint">
                {dir() === 'unescape'
                  ? 'Paste the already-escaped text (quotes included when the variant is quote-wrapped).'
                  : 'Paste the raw text you want made safe for the selected context.'}
              </p>
            </div>
          }
        >
          <CodePanel
            label={dir() === 'escape' ? 'Raw input' : 'Escaped input'}
            value={input()}
            onInput={setInput}
            actions={
              <span class="code-actions">
                <button type="button" class="btn btn-sm btn-ghost" onClick={() => setInput('')}>
                  Clear
                </button>
              </span>
            }
          />
          <Show when={error() !== ''} fallback={null}>
            <div class="error-card">
              <AlertIcon />
              <div>
                <b>Could not {dir()}</b>
                <p>{error()}</p>
              </div>
            </div>
          </Show>
          <div class="cta">
            <button
              type="button"
              class="btn btn-ghost"
              onClick={() => {
                setInput(output());
                setDir(dir() === 'escape' ? 'unescape' : 'escape');
              }}
              disabled={!output()}
            >
              <RefreshIcon /> Swap direction
            </button>
            <AdSlot slot="tool-bottom" />
          </div>
          <Show when={output() !== '' && error() === ''}>
            <CodePanel
              label={dir() === 'escape' ? 'Escaped output' : 'Plain output'}
              value={output()}
              readOnly
              lang="plain"
              stat={`${humanSize(output().length)} · ${active().label}`}
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
    </>
  );
}
