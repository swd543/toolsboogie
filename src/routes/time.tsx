/**
 * Date & time converter: parse any common instant (ISO, RFC 2822, epoch in
 * s/ms/µs/ns, FILETIME, .NET ticks, SQL, C locale — auto-guessed or picked)
 * and render it for many ecosystems, in any IANA timezone.
 */
import { createMemo, createSignal, For, onMount, Show } from 'solid-js';
import { AdSlot } from '~/components/AdSlot';
import { AlertIcon, CopyIcon } from '~/components/Icons';
import { RouteMeta } from '~/components/RouteMeta';
import { ToolColumns, ToolPage } from '~/components/Shell';
import {
  availableTimezones,
  formatInstant,
  INPUT_FORMATS,
  type InputFormat,
  nowParts,
  parseInstant,
} from '~/features/time/logic';
import { copyText } from '~/lib/clipboard';
import { humanSize } from '~/lib/types';

interface OutRow {
  label: string;
  value: string;
  copyable?: boolean;
}

export default function TimePage() {
  const [input, setInput] = createSignal('');
  const [format, setFormat] = createSignal<InputFormat>('auto');
  const [tz, setTz] = createSignal('UTC');
  const [copied, setCopied] = createSignal<string | null>(null);

  // Live "now" ticker.
  const [now, setNow] = createSignal(nowParts());
  onMount(() => {
    const t = setInterval(() => setNow(nowParts()), 1000);
    return () => clearInterval(t);
  });

  const timezones = availableTimezones();

  const parsed = createMemo(() => {
    if (!input().trim()) return null;
    try {
      return { ok: true as const, p: parseInstant(input(), format()) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const formatted = createMemo(() => {
    const p = parsed();
    if (!p?.ok) return null;
    return formatInstant(p.p);
  });

  const rows = createMemo<OutRow[]>(() => {
    const f = formatted();
    if (!f) return [];
    return [
      { label: 'Human-readable', value: f.human(tz()), copyable: false },
      { label: 'ISO 8601 (UTC)', value: f.isoUtc },
      { label: 'RFC 2822 (email)', value: f.rfc2822 },
      { label: 'UNIX epoch · seconds', value: f.epochS },
      { label: 'UNIX epoch · milliseconds', value: f.epochMs },
      { label: 'UNIX epoch · microseconds', value: f.epochUs },
      { label: 'UNIX epoch · nanoseconds', value: f.epochNs },
      { label: 'Windows FILETIME (100ns since 1601)', value: f.filetime },
      { label: '.NET Ticks (since 0001-01-01)', value: f.netTicks },
      { label: 'Python · datetime.isoformat()', value: f.pythonIso },
      { label: 'Python · pandas Timestamp', value: f.pythonPandas },
      { label: 'Linux · date command', value: f.linuxDateCmd, copyable: false },
      { label: 'Linux · date -u output', value: f.linuxDateOut },
      { label: 'SQL (UTC)', value: f.sqlUtc },
      { label: 'PostgreSQL timestamptz', value: f.sqlPostgres },
      { label: 'Go literal', value: f.goLiteral },
      { label: 'JavaScript', value: f.jsLiteral },
      { label: 'C# DateTimeOffset', value: f.dotnet },
    ];
  });

  const copyRow = async (label: string) => {
    if (await copyText(label)) {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    }
  };

  const useNow = () => {
    setInput(new Date().toISOString());
    setFormat('iso');
  };

  const humanUtc = createMemo(() => {
    const f = formatted();
    return f ? f.human('UTC') : '';
  });

  const parseUsed = createMemo(() => {
    const p = parsed();
    return p?.ok ? `${p.p.used}${p.p.guessed ? ' (guessed)' : ''}` : '';
  });
  const parseError = createMemo(() => {
    const p = parsed();
    return p && !p.ok ? p.error : '';
  });

  return (
    <>
      <RouteMeta path="/time" />
      <ToolPage
        tone="dev"
        title="Date & time converter"
        lede="Turn any timestamp into any other: ISO 8601, RFC 2822, epoch (seconds to nanoseconds), Windows FILETIME, .NET ticks, SQL — rendered in the timezone you choose, with copy-ready snippets for Python, pandas, Go, C, Linux and JavaScript."
        related={[
          { path: '/json-format', label: 'JSON format' },
          { path: '/string-escape', label: 'String escape' },
          { path: '/regex', label: 'Regex checker' },
        ]}
      >
        <div class="panel">
          <div class="panel-title">Now — live</div>
          <div class="panel-body" style="display: flex; flex-wrap: wrap; gap: 1.5rem">
            <div>
              <div class="stat-big">{now().epochMs}</div>
              <div class="stat-sub">UNIX ms</div>
            </div>
            <div>
              <div class="stat-big">{now().epochS}</div>
              <div class="stat-sub">UNIX s</div>
            </div>
            <div style="align-self: flex-end">
              <button type="button" class="btn btn-sm btn-ghost" onClick={useNow}>
                Use current time
              </button>
            </div>
          </div>
        </div>

        <ToolColumns
          aside={
            <div class="opt-group">
              <div class="field">
                <span>Input format</span>
                <select
                  value={format()}
                  onChange={(e) => setFormat(e.currentTarget.value as InputFormat)}
                >
                  <For each={INPUT_FORMATS}>{(f) => <option value={f.id}>{f.label}</option>}</For>
                </select>
              </div>
              <p class="opt-hint">
                “Auto-detect” guesses from shape and digit count (10 digits → seconds, 13 → ms, 16 →
                µs, 19 → ns). Zone-less ISO/SQL strings are treated as UTC.
              </p>
              <div class="field">
                <span>Display timezone</span>
                <select value={tz()} onChange={(e) => setTz(e.currentTarget.value)}>
                  <For each={timezones}>{(z) => <option value={z}>{z}</option>}</For>
                </select>
              </div>
              <p class="opt-hint">
                Epoch, FILETIME and .NET ticks are exact (integer math, no rounding);
                sub-millisecond precision is preserved when the input carries it.
              </p>
            </div>
          }
        >
          <div class="panel">
            <div class="panel-title">Timestamp</div>
            <div class="code-wrap" data-error={parseError() ? 'true' : 'false'}>
              <textarea
                class="code-edit"
                rows={3}
                value={input()}
                spellcheck={false}
                placeholder="2026-09-27T12:30:00Z · 1790000000 · 2026-09-27 12:30:00 · Mon, 27 Sep 2026 12:30:00 GMT …"
                aria-label="Timestamp input"
                onInput={(e) => setInput(e.currentTarget.value)}
              />
            </div>
            {parseError() ? (
              <div class="code-bar">
                <span class="code-stat" style="color: var(--color-error)">
                  <AlertIcon /> {parseError()}
                </span>
              </div>
            ) : null}
          </div>

          <Show when={formatted() !== null}>
            <div class="ok-note">
              <CopyIcon />
              <span>
                Parsed as <b>{parseUsed()}</b> · {humanUtc()}
              </span>
            </div>
          </Show>

          <Show when={rows().length > 0}>
            <div class="panel">
              <div class="panel-title">All formats</div>
              <div class="time-rows">
                <For each={rows()}>
                  {(r) => (
                    <div class="time-row">
                      <span class="time-row-label">{r.label}</span>
                      <code class="time-row-value">{r.value}</code>
                      <button
                        type="button"
                        class="btn btn-sm btn-ghost"
                        onClick={() => copyRow(r.value)}
                        aria-label={`Copy ${r.label}`}
                      >
                        {copied() === r.value ? 'Copied ✓' : 'Copy'}
                      </button>
                    </div>
                  )}
                </For>
              </div>
              <div class="code-bar">
                <span class="code-stat">
                  {humanSize(
                    rows()
                      .map((r) => r.value)
                      .join('\n').length,
                  )}{' '}
                  total
                </span>
              </div>
            </div>
          </Show>
          <AdSlot slot="tool-bottom" />
        </ToolColumns>
      </ToolPage>
    </>
  );
}
