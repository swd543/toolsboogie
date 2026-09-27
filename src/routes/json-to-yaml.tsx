/**
 * JSON → YAML converter (Rust/WASM core — the core's serde_yaml is exactly
 * what makes the output clean and round-trip-safe).
 */
import { createSignal, Show } from 'solid-js';
import { AdSlot } from '~/components/AdSlot';
import { AlertIcon, CopyIcon, DownloadIcon, SpinnerIcon } from '~/components/Icons';
import { RouteMeta } from '~/components/RouteMeta';
import { CodePanel, ToolColumns, ToolPage } from '~/components/Shell';
import { jsonToYaml } from '~/features/json-to-yaml/logic';
import { copyText } from '~/lib/clipboard';
import { saveText } from '~/lib/download';
import { humanSize } from '~/lib/types';
import { expandAds } from '~/site/ads';

const SAMPLE = `{
  "server": {
    "host": "localhost",
    "port": 8080,
    "tls": false
  },
  "watched": ["*.ts", "src/**/*"],
  "debug": null
}`;

export default function JsonToYamlPage() {
  const [input, setInput] = createSignal('');
  const [output, setOutput] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [copied, setCopied] = createSignal(false);

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
      const r = await jsonToYaml(input());
      setOutput(r.output);
    } catch (e) {
      setOutput('');
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

  return (
    <>
      <RouteMeta path="/json-to-yaml" />
      <ToolPage
        tone="dev"
        title="JSON to YAML"
        lede="Convert JSON to clean, human-friendly YAML — keys, nesting and arrays rendered the way YAML users expect. Runs entirely in your browser."
        related={[
          { path: '/json-format', label: 'JSON format' },
          { path: '/yaml-format', label: 'YAML format & → JSON' },
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
            <div class="opt-group">
              <span class="opt-label">Good to know</span>
              <p class="opt-hint">
                Numbers, <code>true</code>/<code>false</code> and <code>null</code> are preserved
                exactly; key order follows your JSON (the core keeps insertion order). Only
                single-document JSON is converted — an array or object at the top level.
              </p>
              <p class="opt-hint">
                This tool needs the Rust core; if the page was built without it, run{' '}
                <code>pnpm wasm</code> and rebuild.
              </p>
            </div>
          }
        >
          <CodePanel
            label="Input JSON"
            value={input()}
            onInput={setInput}
            actions={
              <span class="code-actions">
                <button type="button" class="btn btn-sm btn-ghost" onClick={() => setInput(SAMPLE)}>
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
              Convert to YAML
            </button>
            <AdSlot slot="tool-bottom" />
          </div>
          <Show when={output() !== ''}>
            <CodePanel
              label="YAML output"
              value={output()}
              readOnly
              lang="yaml"
              stat={`${humanSize(output().length)} · YAML 1.2`}
              actions={
                <span class="code-actions">
                  <button type="button" class="btn btn-sm btn-ghost" onClick={copyOut}>
                    <CopyIcon /> {copied() ? 'Copied ✓' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost"
                    onClick={() => saveText(output(), 'converted.yaml', 'text/yaml')}
                  >
                    <DownloadIcon /> Download
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
