/**
 * Regex checker & builder.
 *
 * Live matching runs on the ECMAScript engine (the only engine a browser
 * has) — exact for the JavaScript flavor. The flavor selector lints the
 * pattern statically: it flags constructs the target engine (Python, Go,
 * Java, PCRE, POSIX, .NET, Rust) doesn't understand, so you know before
 * you deploy. A chip palette + cheat sheet cover the building blocks.
 */
import { createMemo, createSignal, For, Show } from 'solid-js';
import { AdSlot } from '~/components/AdSlot';
import { AlertIcon, CheckIcon, CopyIcon, PlusIcon } from '~/components/Icons';
import { RouteMeta } from '~/components/RouteMeta';
import { ToolColumns, ToolPage } from '~/components/Shell';
import {
  DEFAULT_FLAGS,
  EXAMPLES,
  FLAVORS,
  type Flavor,
  groupNames,
  lintFlavor,
  type RegexFlags,
  runRegex,
  TOKEN_CHIPS,
} from '~/features/regex/logic';
import { copyText } from '~/lib/clipboard';

const FLAG_DEFS: { id: keyof RegexFlags; label: string; hint: string }[] = [
  { id: 'g', label: 'g', hint: 'global — all matches' },
  { id: 'i', label: 'i', hint: 'case-insensitive' },
  { id: 'm', label: 'm', hint: 'multiline — ^$ per line' },
  { id: 's', label: 's', hint: 'dotall — . matches newlines' },
  { id: 'u', label: 'u', hint: 'unicode — proper code points' },
  { id: 'y', label: 'y', hint: 'sticky — fixed position' },
];

export default function RegexPage() {
  const [pattern, setPattern] = createSignal('[0-9a-f]{6}\\b');
  const [text, setText] = createSignal(
    'accent c8451f, id 550e8400-e29b-41d4-a716-446655440000, bad 12345',
  );
  const [flags, setFlags] = createSignal<RegexFlags>({ ...DEFAULT_FLAGS });
  const [flavor, setFlavor] = createSignal<Flavor>('js');
  const [copiedPattern, setCopiedPattern] = createSignal(false);

  const run = createMemo(() => {
    if (!pattern()) return null;
    try {
      return runRegex(pattern(), text(), flags());
    } catch {
      return null;
    }
  });

  const lint = createMemo(() => (pattern() ? lintFlavor(pattern(), flavor()) : []));
  const names = createMemo(() => (pattern() ? groupNames(pattern()) : []));

  const toggleFlag = (id: keyof RegexFlags) => setFlags((f) => ({ ...f, [id]: !f[id] }));

  const insertAtCursor = (s: string) => {
    const el = patternEl;
    if (!el) {
      setPattern((p) => p + s);
      return;
    }
    const start = el.selectionStart ?? pattern().length;
    const end = el.selectionEnd ?? start;
    setPattern(pattern().slice(0, start) + s + pattern().slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + s.length, start + s.length);
    });
  };

  let patternEl: HTMLInputElement | undefined;

  const copyPattern = async () => {
    if (await copyText(pattern())) {
      setCopiedPattern(true);
      setTimeout(() => setCopiedPattern(false), 1500);
    }
  };

  const flavorInfo = createMemo(() => FLAVORS.find((f) => f.id === flavor())!);

  return (
    <>
      <RouteMeta path="/regex" />
      <ToolPage
        tone="dev"
        title="Regex checker & builder"
        lede="Type a pattern, watch it match live, and get flagged when a construct won't survive your target engine — JavaScript, Python, Go, Java, PCRE, POSIX ERE, .NET or Rust. Live matching uses the browser's ECMAScript engine; the lint is a static feature check per flavor."
        related={[
          { path: '/string-escape', label: 'String escape' },
          { path: '/json-format', label: 'JSON format' },
          { path: '/time', label: 'Date & time' },
        ]}
      >
        <ToolColumns
          aside={
            <div>
              <div class="opt-group">
                <span class="opt-label">Target engine</span>
                <div class="field">
                  <select
                    value={flavor()}
                    onChange={(e) => setFlavor(e.currentTarget.value as Flavor)}
                  >
                    <For each={FLAVORS}>
                      {(f) => (
                        <option value={f.id}>
                          {f.label} — {f.note}
                        </option>
                      )}
                    </For>
                  </select>
                </div>
                <Show
                  when={lint().length > 0}
                  fallback={
                    <p class="opt-hint" style="color: var(--color-ok)">
                      ✓ No compatibility warnings for {flavorInfo().label}.
                    </p>
                  }
                >
                  <ul class="lint-list">
                    <For each={lint()}>
                      {(w) => (
                        <li>
                          <code>{w.snippet}</code> — {w.message}
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
                <p class="opt-hint">
                  Live matching always runs on ECMAScript (the browser's engine). For other flavors
                  the results are a close approximation; the lint above lists what differs.
                </p>
              </div>
              <div class="opt-group">
                <span class="opt-label">Builder</span>
                <div class="chip-row">
                  <For each={TOKEN_CHIPS}>
                    {(c) => (
                      <button
                        type="button"
                        class="chip"
                        title={c.hint}
                        onClick={() => insertAtCursor(c.insert)}
                      >
                        <PlusIcon /> {c.label}
                      </button>
                    )}
                  </For>
                </div>
                <div class="example-list">
                  <For each={EXAMPLES}>
                    {(ex) => (
                      <button
                        type="button"
                        class="example"
                        onClick={() => {
                          setPattern(ex.pattern);
                          setText(ex.test);
                          setFlags({ ...DEFAULT_FLAGS });
                        }}
                      >
                        <b>{ex.label}</b>
                        <span class="example-note">{ex.note}</span>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </div>
          }
        >
          <div class="panel">
            <div class="panel-title">Pattern</div>
            <div class="regex-pattern-row">
              <input
                ref={(el) => (patternEl = el)}
                class="code-inline"
                value={pattern()}
                spellcheck={false}
                aria-label="Regular expression pattern"
                onInput={(e) => setPattern(e.currentTarget.value)}
              />
              <button type="button" class="btn btn-sm btn-ghost" onClick={copyPattern}>
                <CopyIcon /> {copiedPattern() ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
            <div class="flag-row">
              <For each={FLAG_DEFS}>
                {(f) => (
                  <button
                    type="button"
                    class={`chip ${flags()[f.id] ? 'is-on' : ''}`}
                    title={f.hint}
                    aria-pressed={flags()[f.id]}
                    onClick={() => toggleFlag(f.id)}
                  >
                    {f.label}
                  </button>
                )}
              </For>
            </div>
          </div>

          <div class="panel">
            <div class="panel-title">Test input</div>
            <div class="code-wrap">
              <textarea
                class="code-edit"
                rows={4}
                value={text()}
                spellcheck={false}
                aria-label="Text to match against"
                onInput={(e) => setText(e.currentTarget.value)}
              />
            </div>
          </div>

          <Show when={run() !== null && !run()!.ok}>
            <div class="error-card">
              <AlertIcon />
              <div>
                <b>Invalid pattern</b>
                <p>{run()!.error}</p>
              </div>
            </div>
          </Show>

          <Show when={run() !== null && run()!.ok}>
            <div class="panel">
              <div class="panel-title">
                {run()!.matchedCount === 0
                  ? 'No matches'
                  : `${run()!.matchedCount} match${run()!.matchedCount === 1 ? '' : 'es'} · ${run()!.elapsedMs.toFixed(2)} ms`}
              </div>
              <Show
                when={run()!.matches.length > 0}
                fallback={<p class="opt-hint">The pattern is valid but matches nothing here.</p>}
              >
                <div class="match-list">
                  <For each={run()!.matches.map((m, i) => ({ ...m, n: i + 1 }))}>
                    {(m) => (
                      <div class="match-row">
                        <span class="match-idx">#{m.n.toString().padStart(2, '0')}</span>
                        <code class="match-text">{m.text === '' ? '(empty match)' : m.text}</code>
                        <span class="match-at">@ {m.index}</span>
                        {(m.groups.length > 0 || m.groupNames.length > 0) && (
                          <span class="match-groups">
                            {m.groupNames.length > 0
                              ? m.groupNames.map((n, j) => `${n}=${m.groups[j] ?? '∅'}`).join('  ')
                              : m.groups.map((g, j) => `g${j + 1}=${g ?? '∅'}`).join('  ')}
                          </span>
                        )}
                      </div>
                    )}
                  </For>
                </div>
              </Show>
              <Show when={names().length > 0}>
                <div class="ok-note">
                  <CheckIcon />
                  <span>
                    Named groups: <b>{names().join(', ')}</b>
                  </span>
                </div>
              </Show>
            </div>
          </Show>
          <AdSlot slot="tool-bottom" />
        </ToolColumns>
      </ToolPage>
    </>
  );
}
