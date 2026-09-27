/**
 * Shared UI components.
 */

import { useLocation } from '@solidjs/router';
import { createMemo, createSignal, type JSX } from 'solid-js';
import { highlightJson, highlightYaml } from '~/lib/highlight';
import { site, staticPages, tools } from '~/site/config';
import { BoltTiny, Logo, ShieldTiny } from './Icons';

/** Page chrome: sticky header with tool nav, main container, footer. */
export function Shell(props: { children?: JSX.Element }) {
  const location = useLocation();
  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

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
          <nav class="site-nav" aria-label="Tools">
            {tools.map((t) => (
              <a href={t.path} aria-current={isActive(t.path) ? 'page' : undefined}>
                {t.label}
              </a>
            ))}
            {staticPages.map((p) => (
              <a href={p.path} aria-current={isActive(p.path) ? 'page' : undefined}>
                {p.label}
              </a>
            ))}
          </nav>
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
          </nav>
          <div class="donate">
            <span class="donate-label">
              Free to use — but hosting isn't free. If {site.name} helps, a donation is appreciated:
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
  children: JSX.Element;
}) {
  return (
    <div class="tool-page">
      <div class="tool-intro">
        <h1>{props.title}</h1>
        <p class="lede">{props.lede}</p>
        <div class="badge-row">
          <span class="badge">
            <ShieldTiny /> 100% private — runs in your browser
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
