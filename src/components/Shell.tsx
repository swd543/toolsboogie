/**
 * Shared UI components.
 */

import { useLocation } from '@solidjs/router';
import { createEffect, createMemo, createSignal, type JSX, Show } from 'solid-js';
import { highlightJson, highlightYaml } from '~/lib/highlight';
import { site, staticPages, tools } from '~/site/config';
import { BoltTiny, ChevronDownIcon, Logo, ShieldTiny } from './Icons';

/**
 * Nav groups: the tool suite is organised the same way the accents are —
 * guitar (amber), measurement (violet), dev tools (blue). The group
 * buttons are disclosure menus; a single-tool group is a plain link.
 * Order here is the nav order; labels/paths come from the registry.
 */
const NAV_GROUPS: {
  id: string;
  label: string;
  tone: 'guitar' | 'measure' | 'dev';
  paths: string[];
}[] = [
  { id: 'guitar', label: 'Guitar tuner', tone: 'guitar', paths: ['/guitar-tuner'] },
  { id: 'measure', label: 'Measure', tone: 'measure', paths: ['/compass', '/level', '/ruler'] },
  {
    id: 'dev',
    label: 'Dev tools',
    tone: 'dev',
    paths: [
      '/json-format',
      '/json-to-yaml',
      '/yaml-format',
      '/jwt',
      '/regex',
      '/string-escape',
      '/time',
      '/cron',
    ],
  },
];
const groupTools = (paths: string[]) =>
  paths
    .map((p) => tools.find((t) => t.path === p))
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

/** Page chrome: sticky header with tool nav, main container, footer. */
export function Shell(props: { children?: JSX.Element }) {
  const location = useLocation();
  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  const [openGroup, setOpenGroup] = createSignal<string | null>(null);
  const toggleGroup = (id: string) => setOpenGroup(openGroup() === id ? null : id);
  const closeGroups = () => setOpenGroup(null);

  /** Items/tone of the open group (for the shared dropdown panel). */
  const openGroupDef = createMemo(() => NAV_GROUPS.find((g) => g.id === openGroup()) ?? null);
  const openItems = createMemo(() => (openGroupDef() ? groupTools(openGroupDef()!.paths) : []));
  const openTone = createMemo(() => openGroupDef()?.tone ?? 'dev');

  // Close on route change (covers in-app navigation through any link).
  createEffect(() => {
    void location.pathname;
    closeGroups();
  });

  // Close on Escape.
  const onNavKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeGroups();
  };

  const [copiedId, setCopiedId] = createSignal<string | null>(null);
  const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-6)}`;
  const copyAddress = async (id: string, address: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* clipboard unavailable (e.g. insecure context) — the address is visible anyway */
    }
  };

  return (
    <div class="site">
      <header class="site-header">
        <div class="container">
          <a href="/" class="logo" aria-label={`${site.name} home`}>
            <Logo class="logo-mark" />
            <span>{site.name}</span>
          </a>
          <nav class="site-nav-wrap" aria-label="Tools" onKeyDown={onNavKey}>
            <div class="site-nav" onScroll={closeGroups}>
              {NAV_GROUPS.map((g) => {
                const items = groupTools(g.paths);
                if (items.length <= 1) {
                  const t = items[0]!;
                  return (
                    <a
                      class={`nav-link tone-${g.tone}`}
                      href={t.path}
                      aria-current={isActive(t.path) ? 'page' : undefined}
                    >
                      <i class="dot" />
                      {g.label}
                    </a>
                  );
                }
                const groupActive = g.paths.some(isActive);
                return (
                  <span class={`nav-group tone-${g.tone}`}>
                    <button
                      type="button"
                      class="nav-link nav-drop-btn"
                      aria-expanded={openGroup() === g.id}
                      aria-haspopup="true"
                      data-active={groupActive || undefined}
                      onClick={() => toggleGroup(g.id)}
                    >
                      {g.label}
                      <ChevronDownIcon class="chev" />
                    </button>
                  </span>
                );
              })}
              {staticPages.map((p) => (
                <a href={p.path} aria-current={isActive(p.path) ? 'page' : undefined}>
                  {p.label}
                </a>
              ))}
            </div>
            {/* Dropdown panel lives OUTSIDE the scrolling strip so it is
                never clipped; it is anchored to the strip's right edge. */}
            <Show when={openGroup() !== null}>
              <div class={`site-nav-drop tone-${openTone()}`}>
                <ul>
                  {openItems().map((t) => (
                    <li>
                      <a
                        href={t.path}
                        aria-current={isActive(t.path) ? 'page' : undefined}
                        onClick={closeGroups}
                      >
                        <i class="dot" />
                        {t.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </Show>
          </nav>
          <Show when={openGroup() !== null}>
            <button
              type="button"
              class="nav-backdrop"
              aria-label="Close menu"
              onClick={closeGroups}
            />
          </Show>
        </div>
      </header>

      <main id="main" class="site-main">
        <div class="container">{props.children}</div>
      </main>

      <footer class="site-footer">
        <div class="container">
          <span>
            © {new Date().getFullYear()} {site.name} · processed locally, always private.
          </span>
          <nav aria-label="Footer">
            {tools.map((t) => (
              <a href={t.path}>{t.label}</a>
            ))}
            <a href="/privacy">Privacy</a>
            <a href={site.github} target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
          </nav>
          <div class="donate">
            <span class="donate-label">
              Free to use - but hosting isn't free. If {site.name} helps, a donation is appreciated:
            </span>
            {site.donation.map((d) => (
              <span class="donate-addr" title={d.address}>
                {d.scheme ? (
                  <a href={`${d.scheme}:${d.address}`}>
                    {d.label} {shortAddr(d.address)}
                  </a>
                ) : (
                  <span class="donate-plain">
                    {d.label} {shortAddr(d.address)}
                  </span>
                )}
                {d.memo ? <em class="donate-memo">memo {d.memo}</em> : null}
                <button
                  type="button"
                  class="donate-copy"
                  onClick={() => copyAddress(d.id, d.address)}
                  aria-label={`Copy ${d.label} address`}
                >
                  {copiedId() === d.id ? 'Copied ✓' : 'Copy'}
                </button>
              </span>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

/**
 * Tool page scaffold: SEO intro + badges, children, related links.
 */
export function ToolPage(props: {
  title: string;
  lede: string;
  related?: { path: string; label: string }[];
  /** Tool-group accent hue (scoped accent override — see components.css). */
  tone?: 'guitar' | 'measure' | 'dev';
  children: JSX.Element;
}) {
  return (
    <div class={`tool-page ${props.tone ? `tone-${props.tone}` : ''}`}>
      <div class="tool-intro">
        <h1>{props.title}</h1>
        <p class="lede">{props.lede}</p>
        <div class="badge-row">
          <span class="badge">
            <ShieldTiny /> 100% private - runs in your browser
          </span>
          <span class="badge">
            <BoltTiny /> No upload · No account
          </span>
        </div>
      </div>
      {props.children}
      <div class="related">
        <span class="related-label">Related:</span>
        {props.related?.map((r) => (
          <a href={r.path}>{r.label} →</a>
        ))}
      </div>
    </div>
  );
}

/** Two-column tool layout: main interaction area + options aside. */
export function ToolColumns(props: { aside: JSX.Element; children: JSX.Element }) {
  return (
    <div class="tool-grid-cols">
      <div class="tool-main">{props.children}</div>
      <aside class="tool-aside">{props.aside}</aside>
    </div>
  );
}

/**
 * Code panel: a mono textarea (or read-only highlighted view) with a
 * status bar and action buttons. Used by the JSON/YAML/escape/time tools.
 */
export function CodePanel(props: {
  label: string;
  value: string;
  readOnly?: boolean;
  /** `true` when the content failed validation (error border). */
  hasError?: boolean;
  /** Highlight the read-only view with the given language. */
  lang?: 'json' | 'yaml' | 'plain';
  stat?: string;
  onInput?: (v: string) => void;
  actions?: JSX.Element;
}) {
  const highlighted = createMemo(() => {
    if (!props.readOnly || !props.lang || props.lang === 'plain') return null;
    const v = props.value;
    return props.lang === 'json' ? highlightJson(v) : highlightYaml(v);
  });

  return (
    <div class="panel">
      <div class="panel-title">{props.label}</div>
      <div class="code-wrap" data-error={props.hasError ? 'true' : 'false'}>
        {highlighted() !== null ? (
          <pre class="code-view" style="border: 0; margin: 0">
            <code innerHTML={highlighted() ?? ''} />
          </pre>
        ) : (
          <textarea
            class="code-edit"
            value={props.value}
            spellcheck={false}
            rows={14}
            aria-label={props.label}
            onInput={(e) => props.onInput?.(e.currentTarget.value)}
          />
        )}
      </div>
      {(props.stat || props.actions) && (
        <div class="code-bar">
          {props.stat ? <span class="code-stat">{props.stat}</span> : <span />}
          <span class="code-actions">{props.actions}</span>
        </div>
      )}
    </div>
  );
}
