/**
 * JWT logic — decode, inspect, edit and (re-)sign tokens, 100% in the
 * browser via WebCrypto. No network, no key leaving the page.
 *
 * Supported algorithms:
 *  - HS256/384/512  (HMAC-SHA; shared secret)
 *  - RS256/384/512  (RSA-PKCS1v1.5; PEM PKCS#1/PKCS#8 private or SPKI public)
 *  - ES256/384/512  (ECDSA P-256/384/521; PKCS#8 private or SPKI public, or JWK)
 *
 * "none" is decoded but never signed/verified (refused on purpose).
 */

export type JwtAlg =
  | 'none'
  | 'HS256'
  | 'HS384'
  | 'HS512'
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'ES256'
  | 'ES384'
  | 'ES512';

export const HMAC_ALGS: JwtAlg[] = ['HS256', 'HS384', 'HS512'];
export const RSA_ALGS: JwtAlg[] = ['RS256', 'RS384', 'RS512'];
export const EC_ALGS: JwtAlg[] = ['ES256', 'ES384', 'ES512'];

export const SIGN_ALGS: JwtAlg[] = [...HMAC_ALGS, ...RSA_ALGS, ...EC_ALGS];
export const VERIFY_ALGS: JwtAlg[] = SIGN_ALGS;

const HASH_BY_ALG: Record<Exclude<JwtAlg, 'none'>, string> = {
  HS256: 'SHA-256',
  HS384: 'SHA-384',
  HS512: 'SHA-512',
  RS256: 'SHA-256',
  RS384: 'SHA-384',
  RS512: 'SHA-512',
  ES256: 'SHA-256',
  ES384: 'SHA-384',
  ES512: 'SHA-512',
};

const CURVE_BY_ALG: Record<'ES256' | 'ES384' | 'ES512', string> = {
  ES256: 'P-256',
  ES384: 'P-384',
  ES512: 'P-521',
};

/** ECDSA r/s component size in bytes per JWS algorithm. */
const EC_HALF_SIZE: Record<'ES256' | 'ES384' | 'ES512', number> = {
  ES256: 32,
  ES384: 48,
  ES512: 66,
};

export interface DecodedToken {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  /** The raw signature part (may be empty for `alg: none`). */
  signatureB64: string;
  /** Structural problems (not cryptographic). */
  warnings: string[];
}

/* ---------------- base64url ---------------- */

const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function b64urlEncodeText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return b64urlEncode(bytes);
}

export function b64urlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64URL_ALPHABET[b0 >> 2];
    out += B64URL_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64URL_ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64URL_ALPHABET[b2 & 63] : '=';
  }
  return out.replace(/=+$/, '');
}

export function b64urlDecode(s: string): Uint8Array {
  const raw = s.trim();
  const clean = raw.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  // Explicit padding if present; otherwise implicit (padding-less base64url
  // — the JWT case): length mod 4 reveals how many padding chars were
  // omitted (0 → none, 3 → one, 2 → two).
  const explicit = (raw.match(/=+$/) ?? [''])[0].length;
  const padCount = explicit > 0 ? explicit : clean.length % 4 === 0 ? 0 : 4 - (clean.length % 4);
  const padded = clean + '='.repeat(padCount);
  const bin = atob(padded);
  // Each 4-char group decodes to 3 bytes, minus the padding chars.
  const len = (padded.length / 4) * 3 - padCount;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** True when the string is valid base64url (no whitespace, correct chars). */
export function looksLikeBase64(s: string): boolean {
  if (!s || s.length < 8 || s.length % 4 > 2) return false;
  return /^[A-Za-z0-9_-]+={0,2}$/.test(s);
}

/**
 * Import a user-supplied secret: base64(-url) when it looks like it,
 * otherwise UTF-8 text. (Most tools silently mis-interpret this — be
 * explicit: the UI shows which mode was used.)
 */
export function secretBytes(
  secret: string,
  preferBase64: boolean,
): { bytes: Uint8Array; mode: 'base64' | 'text' } {
  if (preferBase64 && looksLikeBase64(secret.trim())) {
    try {
      return { bytes: b64urlDecode(secret.trim()), mode: 'base64' };
    } catch {
      /* fall through to text */
    }
  }
  return { bytes: new TextEncoder().encode(secret), mode: 'text' };
}

/* ---------------- decode ---------------- */

export function splitToken(token: string): {
  headerB64: string;
  payloadB64: string;
  signatureB64: string;
} {
  const parts = token.trim().split('.');
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`A JWT has 2 or 3 dot-separated parts, this has ${parts.length}.`);
  }
  return {
    headerB64: parts[0]!,
    payloadB64: parts[1]!,
    signatureB64: parts[2] ?? '',
  };
}

function decodeSegment<T>(b64: string, what: string): T {
  try {
    const bytes = b64urlDecode(b64);
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`${what} is not valid base64url JSON: ${e instanceof Error ? e.message : e}`);
  }
}

export function decodeToken(token: string): DecodedToken {
  const { headerB64, payloadB64, signatureB64 } = splitToken(token);
  const warnings: string[] = [];
  const header = decodeSegment<Record<string, unknown>>(headerB64, 'Header');
  const payload = decodeSegment<Record<string, unknown>>(payloadB64, 'Payload');
  if (typeof header.alg !== 'string' || header.alg.length === 0) {
    warnings.push('Missing "alg" in header.');
  }
  if (signatureB64 === '' && (typeof header.alg === 'string' ? header.alg : '') !== 'none') {
    warnings.push('No signature part (expected one for this alg).');
  }
  return { header, payload, signatureB64, warnings };
}

/** Human-readable claim states for the UI (exp/iat/nbf vs now). */
export function claimStatuses(
  payload: Record<string, unknown>,
  nowSec: number = Math.floor(Date.now() / 1000),
): { claim: string; text: string; ok: boolean }[] {
  const out: { claim: string; text: string; ok: boolean }[] = [];
  const asNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const exp = asNum(payload.exp);
  if (exp != null) {
    out.push({
      claim: 'exp',
      text: `expires ${new Date(exp * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC`,
      ok: exp > nowSec,
    });
  }
  const iat = asNum(payload.iat);
  if (iat != null) {
    out.push({
      claim: 'iat',
      text: `issued ${new Date(iat * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC`,
      ok: iat <= nowSec + 5,
    });
  }
  const nbf = asNum(payload.nbf);
  if (nbf != null) {
    out.push({
      claim: 'nbf',
      text: `not valid before ${new Date(nbf * 1000).toISOString().replace('T', ' ').slice(0, 19)} UTC`,
      ok: nbf <= nowSec,
    });
  }
  return out;
}

/* ---------------- signing / verification ---------------- */

function subtle(): Crypto['subtle'] {
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto is unavailable — use a secure context (HTTPS or localhost).');
  }
  return globalThis.crypto.subtle;
}

/**
 * Copy into a fresh ArrayBuffer-backed view. WebCrypto's BufferSource is
 * ArrayBufferView<ArrayBuffer> in modern libs; TextEncoder/our helpers can
 * yield ArrayBufferLike views, which some type sets reject.
 */
function bs(u: Uint8Array | ArrayBuffer): BufferSource {
  return u instanceof Uint8Array ? new Uint8Array(u.slice().buffer) : u;
}

function hashName(alg: Exclude<JwtAlg, 'none'>): string {
  return HASH_BY_ALG[alg];
}

function stripPem(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  // Accept both base64 and base64url in the PEM body.
  const b64 = body.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function detectPemFormat(pem: string): 'pkcs8' | 'pkcs1' | 'spki' {
  if (pem.includes('PRIVATE KEY') && !pem.includes('RSA')) return 'pkcs8'; // PKCS#8 (any)
  if (pem.includes('RSA PRIVATE KEY')) return 'pkcs1';
  return 'spki'; // PUBLIC KEY (or RSA PUBLIC KEY)
}

/**
 * Convert a DER-encoded ECDSA signature (r, s) to the fixed-size JWS
 * form r||s. `halfSize` is the curve's component size (32 / 48 / 66).
 */
export function derToRawEcdsa(der: Uint8Array, halfSize = 32): Uint8Array {
  if (der[0] !== 0x30) throw new Error('Not a DER-encoded ECDSA signature.');
  let i = 1;
  // sequence length (assume < 128, true for all JWT curves)
  i += 1;
  const readInt = () => {
    if (der[i] !== 0x02) throw new Error('Malformed DER integer.');
    i += 1;
    const len = der[i]!;
    i += 1;
    const bytes = der.subarray(i, i + len);
    i += len;
    // strip a leading zero byte
    const start = bytes[0] === 0 ? 1 : 0;
    const body = bytes.subarray(start);
    if (body.length > halfSize) throw new Error('DER integer longer than the curve size.');
    return body;
  };
  const r = readInt();
  const s = readInt();
  const out = new Uint8Array(halfSize * 2);
  out.set(r, halfSize - r.length);
  out.set(s, halfSize * 2 - s.length);
  return out;
}

/** Convert raw r||s to a DER ECDSA signature. */
export function rawToDerEcdsa(raw: Uint8Array): Uint8Array {
  const size = raw.length / 2;
  const r = raw.subarray(0, size);
  const s = raw.subarray(size);
  const encInt = (v: Uint8Array) => {
    // Strip leading zeros, but keep one 0x00 when the top bit is set.
    let start = 0;
    while (start < v.length - 1 && v[start] === 0) start += 1;
    const body = v.subarray(start);
    const needsPad = (body[0]! & 0x80) !== 0;
    return needsPad ? [0x02, body.length + 1, 0, ...body] : [0x02, body.length, ...body];
  };
  const rEnc = encInt(r);
  const sEnc = encInt(s);
  const bodyLen = rEnc.length + sEnc.length;
  const out = new Uint8Array(2 + bodyLen);
  out[0] = 0x30;
  out[1] = bodyLen;
  out.set(rEnc, 2);
  out.set(sEnc, 2 + rEnc.length);
  return out;
}

export interface SignOptions {
  alg: JwtAlg;
  /** HMAC secret (text or base64) — for HS*. */
  secret?: string;
  /** Secret is base64 (vs text) — for HS*. */
  secretIsBase64?: boolean;
  /** Private key PEM (PKCS#1 / PKCS#8) or JWK string — for RSA & EC algorithms. */
  privateKey?: string;
}

export async function signToken(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  opts: SignOptions,
): Promise<{ token: string; headerB64: string; payloadB64: string; signatureB64: string }> {
  const alg = opts.alg;
  if (alg === 'none') throw new Error('Refusing to sign with alg "none".');

  const hB64 = b64urlEncodeText(JSON.stringify(header));
  const pB64 = b64urlEncodeText(JSON.stringify(payload));
  const signingInput = new TextEncoder().encode(`${hB64}.${pB64}`);
  const subtleApi = subtle();
  let sig: Uint8Array;

  if (HMAC_ALGS.includes(alg)) {
    const { bytes } = secretBytes(opts.secret ?? '', opts.secretIsBase64 ?? false);
    const key = await subtleApi.importKey(
      'raw',
      bs(bytes),
      { name: 'HMAC', hash: hashName(alg) },
      false,
      ['sign'],
    );
    const raw = await subtleApi.sign('HMAC', key, bs(signingInput));
    sig = new Uint8Array(raw);
  } else if (RSA_ALGS.includes(alg)) {
    if (!opts.privateKey) throw new Error('Provide a private key (PEM) for RS* algorithms.');
    const pem = opts.privateKey;
    const fmt = detectPemFormat(pem);
    if (fmt === 'spki')
      throw new Error('That PEM looks like a PUBLIC key — signing needs a private key.');
    if (fmt === 'pkcs1') {
      throw new Error(
        'PKCS#1 ("RSA PRIVATE KEY") PEM is not accepted by browser WebCrypto — convert to PKCS#8 (e.g. `openssl pkcs8 -topk8 -nocrypt -in key.pem`) or paste a JWK.',
      );
    }
    const der = stripPem(pem);
    const key = await subtleApi.importKey(
      fmt,
      bs(der),
      { name: 'RSASSA-PKCS1-v1_5', hash: hashName(alg) },
      false,
      ['sign'],
    );
    const raw = await subtleApi.sign('RSASSA-PKCS1-v1_5', key, bs(signingInput));
    sig = new Uint8Array(raw);
  } else if (EC_ALGS.includes(alg)) {
    const ec = alg as 'ES256' | 'ES384' | 'ES512';
    if (!opts.privateKey)
      throw new Error('Provide a private key (PEM PKCS#8 or JWK) for ES* algorithms.');
    const pk = opts.privateKey.trim();
    const key = pk.startsWith('{')
      ? await subtleApi.importKey(
          'jwk',
          JSON.parse(pk),
          { name: 'ECDSA', namedCurve: CURVE_BY_ALG[ec] },
          false,
          ['sign'],
        )
      : await subtleApi.importKey(
          'pkcs8',
          bs(stripPem(pk)),
          { name: 'ECDSA', namedCurve: CURVE_BY_ALG[ec] },
          false,
          ['sign'],
        );
    const raw = await subtleApi.sign({ name: 'ECDSA', hash: hashName(alg) }, key, bs(signingInput));
    const platformSig = new Uint8Array(raw);
    // Browsers emit DER per the WebCrypto spec; Node emits raw r||s. The
    // JWS form is always raw — convert when the signature is DER.
    if (platformSig[0] === 0x30) {
      try {
        sig = derToRawEcdsa(platformSig, EC_HALF_SIZE[alg as 'ES256']);
      } catch {
        sig = platformSig;
      }
    } else {
      sig = platformSig;
    }
  } else {
    throw new Error(`Unsupported algorithm: ${alg}`);
  }

  const signatureB64 = b64urlEncode(sig);
  return {
    token: `${hB64}.${pB64}.${signatureB64}`,
    headerB64: hB64,
    payloadB64: pB64,
    signatureB64,
  };
}

export interface VerifyOptions {
  /** HMAC secret (text or base64) — for HS*. */
  secret?: string;
  secretIsBase64?: boolean;
  /** Public key PEM (SPKI) or JWK string — for RSA & EC verification. */
  publicKey?: string;
}

export async function verifyToken(
  token: string,
  opts: VerifyOptions,
): Promise<{ valid: boolean; reason: string; alg: string }> {
  const { headerB64, payloadB64, signatureB64 } = splitToken(token);
  const header = decodeSegment<Record<string, unknown>>(headerB64, 'Header');
  const alg = (header.alg as string) ?? '';
  if (alg === 'none' || alg === '') {
    return { valid: false, reason: 'alg "none" — unsigned tokens are refused.', alg };
  }
  if (!signatureB64) {
    return { valid: false, reason: 'Missing signature part.', alg };
  }
  const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = b64urlDecode(signatureB64);
  const subtleApi = subtle();

  try {
    if (HMAC_ALGS.includes(alg as JwtAlg)) {
      const { bytes } = secretBytes(opts.secret ?? '', opts.secretIsBase64 ?? false);
      const key = await subtleApi.importKey(
        'raw',
        bs(bytes),
        { name: 'HMAC', hash: hashName(alg as Exclude<JwtAlg, 'none'>) },
        false,
        ['verify'],
      );
      const ok = await subtleApi.verify('HMAC', key, bs(sig), bs(signingInput));
      return ok
        ? { valid: true, reason: 'Signature matches.', alg }
        : { valid: false, reason: 'Signature mismatch — wrong secret or different token.', alg };
    }
    if (RSA_ALGS.includes(alg as JwtAlg)) {
      if (!opts.publicKey)
        throw new Error('Provide a public key (PEM or JWK) for RS* verification.');
      const pk = opts.publicKey.trim();
      const key = pk.startsWith('{')
        ? await subtleApi.importKey(
            'jwk',
            JSON.parse(pk),
            { name: 'RSASSA-PKCS1-v1_5', hash: hashName(alg as Exclude<JwtAlg, 'none'>) },
            false,
            ['verify'],
          )
        : await subtleApi.importKey(
            'spki',
            bs(stripPem(pk)),
            { name: 'RSASSA-PKCS1-v1_5', hash: hashName(alg as Exclude<JwtAlg, 'none'>) },
            false,
            ['verify'],
          );
      const ok = await subtleApi.verify('RSASSA-PKCS1-v1_5', key, bs(sig), bs(signingInput));
      return ok
        ? { valid: true, reason: 'Signature matches.', alg }
        : { valid: false, reason: 'Signature mismatch — wrong key or different token.', alg };
    }
    if (EC_ALGS.includes(alg as JwtAlg)) {
      const ec = alg as 'ES256' | 'ES384' | 'ES512';
      if (!opts.publicKey)
        throw new Error('Provide a public key (PEM or JWK) for ES* verification.');
      const pk = opts.publicKey.trim();
      const key = pk.startsWith('{')
        ? await subtleApi.importKey(
            'jwk',
            JSON.parse(pk),
            { name: 'ECDSA', namedCurve: CURVE_BY_ALG[ec] },
            false,
            ['verify'],
          )
        : await subtleApi.importKey(
            'spki',
            bs(stripPem(pk)),
            { name: 'ECDSA', namedCurve: CURVE_BY_ALG[ec] },
            false,
            ['verify'],
          );
      const der = rawToDerEcdsa(sig);
      // Browsers require DER; Node requires raw r||s. Try both — exactly
      // one will verify (the other returns false or throws).
      let ok = false;
      try {
        ok = await subtleApi.verify(
          { name: 'ECDSA', hash: hashName(alg as Exclude<JwtAlg, 'none'>) },
          key,
          bs(der),
          bs(signingInput),
        );
      } catch {
        ok = false;
      }
      if (!ok) {
        try {
          ok = await subtleApi.verify(
            { name: 'ECDSA', hash: hashName(alg as Exclude<JwtAlg, 'none'>) },
            key,
            bs(sig),
            bs(signingInput),
          );
        } catch {
          ok = false;
        }
      }
      return ok
        ? { valid: true, reason: 'Signature matches.', alg }
        : { valid: false, reason: 'Signature mismatch — wrong key or different token.', alg };
    }
    return { valid: false, reason: `Unsupported algorithm: ${alg}`, alg };
  } catch (e) {
    return {
      valid: false,
      reason: `Could not verify: ${e instanceof Error ? e.message : String(e)}`,
      alg,
    };
  }
}
