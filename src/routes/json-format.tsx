/**
 * JSON formatter & minifier.
 *
 * Fast path: Rust/WASM core (serde_json) with exact error positions and
 * insertion/sorted key order. Fallback (no core): the engine's JSON.parse —
 * the tool keeps working, with an approximate error position.
 */
import { createMemo, createSignal, Show } from 'solid-js';
import { AdSlot } from '~/components/AdSlot';
import { AlertIcon, CheckIcon, CopyIcon, DownloadIcon, SpinnerIcon } from '~/components/Icons';
import { RouteMeta } from '~/components/RouteMeta';
import { CodePanel, ToolColumns, ToolPage } from '~/components/Shell';
import { formatJson } from '~/features/json-format/logic';
import { copyText } from '~/lib/clipboard';
import { saveText } from '~/lib/download';
import { humanSize } from '~/lib/types';
import { expandAds } from '~/site/ads';

const SAMPLE = `{
  "name": "ToolsBoogie",
  "tools": ["tuner", "json", "yaml", "jwt", "compass", "ruler", "level"],
  "uploads": 0,
  "private": true,
  "stats": { "bytes": 1048576, "fast": null }
}`;

export default function JsonFormatPage() {
  const [input, setInput] = createSignal('');
  const [output, setOutput] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [via, setVia] = createSignal<'wasm' | 'js' | null>(null);
  const [copied, setCopied] = createSignal(false);

  const [indent, setIndent] = createSignal(2);
  const [minify, setMinify] = createSignal(false);
  const [sortKeys, setSortKeys] = createSignal(false);

  const outStat = createMemo(() => {
    const v = output();
    if (!v) return '';
    return `${humanSize(v.length)} · ${via() === 'wasm' ? 'Rust core' : 'JS'}`;
  });

  const run = async () => {
    if (!input().trim()) {
      setError('Paste some JSON first.');
      setOutput('');
      return;
    }
    expandAds();
    setBusy(true);
    setError('');
    try {
      const r = await formatJson(input(), {
        indent: minify() ? 0 : indent(),
        sortKeys: sortKeys(),
      });
      setOutput(r.output);
      setVia(r.via);
    } catch (e) {
      setOutput('');
      setVia(null);
      setError(e instanceof Error ? e.message : String(e));
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

  const sample = () => {
    setInput(SAMPLE);
    setOutput('');
    setError('');
  };

  return (
    <>
      <RouteMeta path="/json-format" />
      <ToolPage
        tone="dev"
        title="JSON format & minify"
        lede="Pretty-print, minify, sort keys and validate JSON. Errors point at the exact line and column. Your JSON never leaves the page."
        related={[
          { path: '/json-to-yaml', label: 'JSON → YAML' },
          { path: '/yaml-format', label: 'YAML format' },
          { path: '/string-escape', label: 'String escape' },
        ]}
      >
        <Show when={error() !== ''} fallback={null}>
          <div class="error-card">
            <AlertIcon />
            <div>
              <b>Could not parse JSON</b>
              <p>{error()}</p>
            </div>
          </div>
        </Show>
        <ToolColumns
          aside={
            <div class="opt-group">
              <span class="opt-label">Indentation</span>
              <div class="field">
                <span>Spaces</span>
                <select
                  value={String(indent())}
                  onChange={(e) => setIndent(Number(e.currentTarget.value))}
                >
                  <option value="2">2</option>
                  <option value="4">4</option>
                  <option value="8">8</option>
                </select>
              </div>
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={minify()}
                  onChange={(e) => setMinify(e.currentTarget.checked)}
                />
                <span class="knob" />
                <span class="toggle-text">Minify (one line)</span>
              </label>
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={sortKeys()}
                  onChange={(e) => setSortKeys(e.currentTarget.checked)}
                />
                <span class="knob" />
                <span class="toggle-text">Sort object keys</span>
              </label>
              <p class="opt-hint">
                Without the Rust core (run <code>pnpm wasm</code> to build it) the formatter falls
                back to the engine's JSON — same result, approximate error positions.
              </p>
            </div>
          }
        >
          <CodePanel
            label="Input JSON"
            value={input()}
            onInput={setInput}
            lang="plain"
            actions={
              <span class="code-actions">
                <button type="button" class="btn btn-sm btn-ghost" onClick={sample}>
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
              {minify() ? 'Minify JSON' : 'Format JSON'}
            </button>
            <AdSlot slot="tool-bottom" />
          </div>
          <Show when={output() !== ''}>
            <CodePanel
              label="Output"
              value={output()}
              readOnly
              lang="json"
              stat={outStat()}
              actions={
                <span class="code-actions">
                  <button type="button" class="btn btn-sm btn-ghost" onClick={copyOut}>
                    <CopyIcon /> {copied() ? 'Copied ✓' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost"
                    onClick={() => saveText(output(), 'formatted.json', 'application/json')}
                  >
                    <DownloadIcon /> Download
                  </button>
                  <CheckIcon />
                </span>
              }
            />
          </Show>
        </ToolColumns>
      </ToolPage>
    </>
  );
}
