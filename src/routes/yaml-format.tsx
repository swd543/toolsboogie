/**
 * YAML formatter / validator, with a YAML → JSON direction.
 */
import { createMemo, createSignal, Show } from 'solid-js';
import { AdSlot } from '~/components/AdSlot';
import { AlertIcon, CopyIcon, DownloadIcon, SpinnerIcon } from '~/components/Icons';
import { RouteMeta } from '~/components/RouteMeta';
import { CodePanel, ToolColumns, ToolPage } from '~/components/Shell';
import { yamlFormat, yamlToJson } from '~/features/yaml-format/logic';
import { copyText } from '~/lib/clipboard';
import { saveText } from '~/lib/download';
import { humanSize } from '~/lib/types';
import { expandAds } from '~/site/ads';

const SAMPLE = `server:
  host: localhost
  port: 8080
  tls: false
watched:
  - "*.ts"
  - src/**/*
debug: null
retries: 3`;

type Mode = 'format' | 'to-json';

export default function YamlFormatPage() {
  const [input, setInput] = createSignal('');
  const [output, setOutput] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  const [mode, setMode] = createSignal<Mode>('format');

  const outStat = createMemo(() =>
    output() ? `${humanSize(output().length)} · ${mode() === 'format' ? 'YAML' : 'JSON'}` : '',
  );

  const run = async () => {
    if (!input().trim()) {
      setError('Paste some YAML first.');
      setOutput('');
      return;
    }
    expandAds();
    setBusy(true);
    setError('');
    try {
      const r = mode() === 'format' ? await yamlFormat(input()) : await yamlToJson(input());
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
      <RouteMeta path="/yaml-format" />
      <ToolPage
        title="YAML format & validate"
        lede="Re-format YAML with consistent indentation, or convert it to JSON. Invalid YAML gets a precise error location. All local."
        related={[
          { path: '/json-format', label: 'JSON format' },
          { path: '/json-to-yaml', label: 'JSON → YAML' },
        ]}
      >
        <div class="tabs" role="tablist">
          <button
            type="button"
            class={`tab ${mode() === 'format' ? 'active' : ''}`}
            role="tab"
            aria-selected={mode() === 'format'}
            onClick={() => {
              setMode('format');
              setOutput('');
            }}
          >
            Re-format YAML
          </button>
          <button
            type="button"
            class={`tab ${mode() === 'to-json' ? 'active' : ''}`}
            role="tab"
            aria-selected={mode() === 'to-json'}
            onClick={() => {
              setMode('to-json');
              setOutput('');
            }}
          >
            YAML → JSON
          </button>
        </div>
        <Show when={error() !== ''} fallback={null}>
          <div class="error-card">
            <AlertIcon />
            <div>
              <b>{mode() === 'format' ? 'Could not parse YAML' : 'Could not convert'}</b>
              <p>{error()}</p>
            </div>
          </div>
        </Show>
        <ToolColumns
          aside={
            <div class="opt-group">
              <span class="opt-label">Good to know</span>
              <p class="opt-hint">
                Single-document YAML is supported (multi-document streams like <code>---</code>
                -separated bundles are rejected with a clear error). Tabs in indentation are treated
                as invalid, per the YAML spec.
              </p>
            </div>
          }
        >
          <CodePanel
            label="Input YAML"
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
              {mode() === 'format' ? 'Re-format YAML' : 'Convert to JSON'}
            </button>
            <AdSlot slot="tool-bottom" />
          </div>
          <Show when={output() !== ''}>
            <CodePanel
              label={mode() === 'format' ? 'YAML output' : 'JSON output'}
              value={output()}
              readOnly
              lang={mode() === 'format' ? 'yaml' : 'json'}
              stat={outStat()}
              actions={
                <span class="code-actions">
                  <button type="button" class="btn btn-sm btn-ghost" onClick={copyOut}>
                    <CopyIcon /> {copied() ? 'Copied ✓' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost"
                    onClick={() =>
                      saveText(
                        output(),
                        mode() === 'format' ? 'formatted.yaml' : 'converted.json',
                        mode() === 'format' ? 'text/yaml' : 'application/json',
                      )
                    }
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
