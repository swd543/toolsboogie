/**
 * JWT tool: decode & inspect (claims + time statuses + structural
 * warnings), then sign (HS/RS/ES) or verify — all via WebCrypto, all
 * local. Keys and secrets never leave the page.
 */
import { createMemo, createSignal, For, Show } from 'solid-js';
import { AdSlot } from '~/components/AdSlot';
import {
  AlertIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  SpinnerIcon,
  XIcon,
} from '~/components/Icons';
import { RouteMeta } from '~/components/RouteMeta';
import { CodePanel, ToolColumns, ToolPage } from '~/components/Shell';
import {
  claimStatuses,
  decodeToken,
  type JwtAlg,
  SIGN_ALGS,
  signToken,
  verifyToken,
} from '~/features/jwt/logic';
import { copyText } from '~/lib/clipboard';
import { saveText } from '~/lib/download';
import { humanSize } from '~/lib/types';
import { expandAds } from '~/site/ads';

const SAMPLE_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

const pretty = (o: unknown) => JSON.stringify(o, null, 2);

export default function JwtPage() {
  const [token, setToken] = createSignal('');
  const [tab, setTab] = createSignal<'inspect' | 'signverify'>('inspect');

  // ----- decode & inspect -----
  const decoded = createMemo(() => {
    if (!token().trim()) return null;
    try {
      return { ok: true as const, d: decodeToken(token().trim()) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  const claims = createMemo(() => {
    const d = decoded();
    return d?.ok ? claimStatuses(d.d.payload) : [];
  });

  const decodeErr = createMemo(() => {
    const d = decoded();
    return !d || d.ok ? '' : d.error;
  });
  const decodeOk = createMemo(() => {
    const d = decoded();
    return d?.ok ? d.d : null;
  });

  // ----- sign / verify -----
  const [headerJson, setHeaderJson] = createSignal(pretty({ alg: 'HS256', typ: 'JWT' }));
  const [payloadJson, setPayloadJson] = createSignal(
    pretty({ sub: '1', name: 'John Doe', iat: 0 }),
  );
  const [alg, setAlg] = createSignal<JwtAlg>('HS256');
  const [secret, setSecret] = createSignal('');
  const [secretB64, setSecretB64] = createSignal(false);
  const [privKey, setPrivKey] = createSignal('');
  const [pubKey, setPubKey] = createSignal('');

  const [busy, setBusy] = createSignal(false);
  const [outToken, setOutToken] = createSignal('');
  const [verify, setVerify] = createSignal<{ valid: boolean; reason: string } | null>(null);
  const [actionError, setActionError] = createSignal('');
  const [copied, setCopied] = createSignal(false);

  const isHmac = createMemo(() => alg().startsWith('HS'));
  const isNone = createMemo(() => alg() === 'none');

  const parseJson = (s: string, what: string): Record<string, unknown> => {
    try {
      const v = JSON.parse(s) as unknown;
      if (!v || typeof v !== 'object' || Array.isArray(v))
        throw new Error(`${what} must be a JSON object.`);
      return v as Record<string, unknown>;
    } catch (e) {
      throw new Error(`${what}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const doSign = async () => {
    expandAds();
    setBusy(true);
    setActionError('');
    setOutToken('');
    setVerify(null);
    try {
      const header = { ...parseJson(headerJson(), 'Header'), alg: alg() };
      const payload = parseJson(payloadJson(), 'Payload');
      if (payload.iat === undefined) payload.iat = Math.floor(Date.now() / 1000);
      const r = await signToken(
        header,
        payload,
        isHmac()
          ? { alg: alg(), secret: secret(), secretIsBase64: secretB64() }
          : { alg: alg(), privateKey: privKey() },
      );
      setOutToken(r.token);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doVerify = async () => {
    expandAds();
    setBusy(true);
    setActionError('');
    setOutToken('');
    const t = outToken() || token().trim();
    if (!t) {
      setActionError('Paste or generate a token first.');
      setBusy(false);
      return;
    }
    setVerify(null);
    try {
      const r = await verifyToken(
        t,
        isHmac() ? { secret: secret(), secretIsBase64: secretB64() } : { publicKey: pubKey() },
      );
      setVerify(r);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyOut = async () => {
    if (await copyText(outToken())) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <>
      <RouteMeta path="/jwt" />
      <ToolPage
        tone="dev"
        title="JWT decode, sign & verify"
        lede="Decode a token, inspect header, payload and time claims, then sign or verify with HS256/384/512, RS256/384/512 or ES256/384/512 — via WebCrypto, entirely on your device. Secrets and keys never leave the page."
        related={[
          { path: '/json-format', label: 'JSON format' },
          { path: '/time', label: 'Date & time (epoch ↔ date)' },
        ]}
      >
        <div class="tabs" role="tablist">
          <button
            type="button"
            class={`tab ${tab() === 'inspect' ? 'active' : ''}`}
            role="tab"
            aria-selected={tab() === 'inspect'}
            onClick={() => setTab('inspect')}
          >
            Decode & inspect
          </button>
          <button
            type="button"
            class={`tab ${tab() === 'signverify' ? 'active' : ''}`}
            role="tab"
            aria-selected={tab() === 'signverify'}
            onClick={() => setTab('signverify')}
          >
            Sign / verify
          </button>
        </div>

        <Show when={tab() === 'inspect'}>
          <ToolColumns
            aside={
              <div class="opt-group">
                <span class="opt-label">Good to know</span>
                <p class="opt-hint">
                  Decoding needs no key — the token is not encrypted, only (optionally) signed. The
                  signature check happens in “Sign / verify”.
                </p>
                <p class="opt-hint">
                  Tokens with <code>alg: none</code> are decoded for inspection but are never signed
                  or verified here.
                </p>
              </div>
            }
          >
            <CodePanel
              label="Token"
              value={token()}
              onInput={setToken}
              lang="plain"
              stat={decodeOk() !== null ? humanSize(token().length) : undefined}
              actions={
                <span class="code-actions">
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost"
                    onClick={() => setToken(SAMPLE_TOKEN)}
                  >
                    Sample
                  </button>
                  <button type="button" class="btn btn-sm btn-ghost" onClick={() => setToken('')}>
                    Clear
                  </button>
                </span>
              }
            />
            <Show when={decodeErr() !== ''}>
              <div class="error-card">
                <AlertIcon />
                <div>
                  <b>Could not decode</b>
                  <p>{decodeErr()}</p>
                </div>
              </div>
            </Show>
            <Show when={decodeOk() !== null}>
              <Show when={decodeOk()!.warnings.length > 0}>
                <div class="error-card" style="border-color: var(--color-warn)">
                  <AlertIcon />
                  <div>
                    <b>Structural warnings</b>
                    <ul style="margin: 0.4rem 0 0 1rem">
                      <For each={decodeOk()!.warnings}>{(w) => <li>{w}</li>}</For>
                    </ul>
                  </div>
                </div>
              </Show>
              <CodePanel label="Header" value={pretty(decodeOk()!.header)} readOnly lang="json" />
              <CodePanel
                label="Payload (claims)"
                value={pretty(decodeOk()!.payload)}
                readOnly
                lang="json"
              />
              <Show when={claims().length > 0}>
                <div class="panel">
                  <div class="panel-title">Time claims</div>
                  <div class="claim-list">
                    <For each={claims()}>
                      {(c) => (
                        <div class="claim-row">
                          {c.ok ? <CheckIcon /> : <XIcon />}
                          <b>{c.claim}</b>
                          <span>{c.text}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
            </Show>
            <AdSlot slot="tool-bottom" />
          </ToolColumns>
        </Show>

        <Show when={tab() === 'signverify'}>
          <ToolColumns
            aside={
              <div class="opt-group">
                <div class="field">
                  <span>Algorithm</span>
                  <select value={alg()} onChange={(e) => setAlg(e.currentTarget.value as JwtAlg)}>
                    <For each={SIGN_ALGS}>{(a) => <option value={a}>{a}</option>}</For>
                  </select>
                </div>
                <Show when={isHmac()}>
                  <div class="field">
                    <span>HMAC secret</span>
                    <input
                      class="code-inline"
                      type="password"
                      value={secret()}
                      placeholder="shared secret"
                      onInput={(e) => setSecret(e.currentTarget.value)}
                    />
                  </div>
                  <label class="toggle">
                    <input
                      type="checkbox"
                      checked={secretB64()}
                      onChange={(e) => setSecretB64(e.currentTarget.checked)}
                    />
                    <span class="knob" />
                    <span class="toggle-text">Secret is base64(-url)</span>
                  </label>
                </Show>
                <Show when={!isHmac()}>
                  <div class="field">
                    <span>Private key (sign) — PKCS#8 PEM or JWK</span>
                    <textarea
                      class="code-edit"
                      rows={4}
                      value={privKey()}
                      spellcheck={false}
                      placeholder="-----BEGIN PRIVATE KEY----- …"
                      onInput={(e) => setPrivKey(e.currentTarget.value)}
                    />
                  </div>
                  <div class="field">
                    <span>Public key (verify) — SPKI PEM or JWK</span>
                    <textarea
                      class="code-edit"
                      rows={4}
                      value={pubKey()}
                      spellcheck={false}
                      placeholder="-----BEGIN PUBLIC KEY----- …"
                      onInput={(e) => setPubKey(e.currentTarget.value)}
                    />
                  </div>
                  <p class="opt-hint">
                    ES256 → P-256, ES384 → P-384, ES512 → P-521. Keys are generated/loaded by
                    WebCrypto; they never leave the page.
                  </p>
                </Show>
              </div>
            }
          >
            <div class="jwt-2col">
              <CodePanel
                label="Header (JSON)"
                value={headerJson()}
                onInput={setHeaderJson}
                lang="plain"
              />
              <CodePanel
                label="Payload (JSON)"
                value={payloadJson()}
                onInput={setPayloadJson}
                lang="plain"
              />
            </div>
            <div class="cta">
              <button
                type="button"
                class="btn btn-primary"
                onClick={doSign}
                disabled={busy() || isNone()}
              >
                {busy() ? <SpinnerIcon /> : null}
                {outToken() !== '' ? 'Re-sign' : 'Sign token'}
              </button>
              <button type="button" class="btn btn-ghost" onClick={doVerify} disabled={busy()}>
                {busy() ? <SpinnerIcon /> : null}
                Verify signature
              </button>
              <AdSlot slot="tool-bottom" />
            </div>
            <Show when={actionError() !== ''}>
              <div class="error-card">
                <AlertIcon />
                <div>
                  <b>Problem</b>
                  <p>{actionError()}</p>
                </div>
              </div>
            </Show>
            <Show when={outToken() !== ''}>
              <CodePanel
                label="Signed token"
                value={outToken()}
                readOnly
                lang="plain"
                stat={humanSize(outToken().length)}
                actions={
                  <span class="code-actions">
                    <button type="button" class="btn btn-sm btn-ghost" onClick={copyOut}>
                      <CopyIcon /> {copied() ? 'Copied ✓' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      class="btn btn-sm btn-ghost"
                      onClick={() => saveText(outToken(), 'token.jwt', 'text/plain')}
                    >
                      <DownloadIcon /> Download
                    </button>
                  </span>
                }
              />
            </Show>
            <Show when={verify() !== null}>
              <div class={verify()!.valid ? 'ok-note' : 'error-card'}>
                {verify()!.valid ? <CheckIcon /> : <XIcon />}
                <span>
                  <b>{verify()!.valid ? 'Signature valid ✓' : 'Signature invalid'}</b> —{' '}
                  {verify()!.reason}
                </span>
              </div>
            </Show>
          </ToolColumns>
        </Show>
      </ToolPage>
    </>
  );
}
