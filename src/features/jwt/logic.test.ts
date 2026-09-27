/**
 * JWT logic tests — HS256 is cross-checked against node:crypto (an
 * independent HMAC implementation; the widely-circulated jwt.io example
 * token carries a placeholder signature that no secret verifies, so the
 * expected signature is computed in-test). ES256/RS256 round-trip through
 * real WebCrypto keys (Node's webcrypto in the vitest environment).
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  b64urlDecode,
  b64urlEncode,
  b64urlEncodeText,
  claimStatuses,
  decodeToken,
  derToRawEcdsa,
  rawToDerEcdsa,
  secretBytes,
  signToken,
  verifyToken,
} from './logic';

const JWT_IO_HEADER = { alg: 'HS256', typ: 'JWT' };
const JWT_IO_PAYLOAD = { sub: '1234567890', name: 'John Doe', iat: 1516239022 };
const JWT_IO_SECRET = 'secret';
const JWT_IO_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('base64url', () => {
  it('encodes the canonical jwt.io header/payload', () => {
    expect(b64urlEncodeText(JSON.stringify(JWT_IO_HEADER))).toBe(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    );
    expect(b64urlEncodeText(JSON.stringify(JWT_IO_PAYLOAD))).toBe(
      'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ',
    );
  });

  it('round-trips arbitrary bytes (including 1/2 mod 3 lengths)', () => {
    for (const n of [1, 2, 3, 7, 64]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37) & 0xff);
      expect(b64urlEncode(bytes)).not.toContain('+');
      expect(b64urlEncode(bytes)).not.toContain('/');
      expect(Array.from(b64urlDecode(b64urlEncode(bytes)))).toEqual(Array.from(bytes));
    }
  });

  it('accepts base64 (with +/ and padding) as base64url', () => {
    // "ko" is 0x6b 0x6f → base64 "a28=", base64url "a28"
    expect([...b64urlDecode('a28=')]).toEqual([0x6b, 0x6f]);
    // 3 data bytes, 1 byte — all group sizes.
    expect([...b64urlDecode('YWJ2')]).toEqual([0x61, 0x62, 0x76]); // 'abv'
    expect([...b64urlDecode('YWI=')]).toEqual([0x61, 0x62]); // 'ab'
    expect([...b64urlDecode('YQ==')]).toEqual([0x61]); // 'a'
    // base64url alphabet (- at 62, _ at 63): 0xfb 0xef → 62,62,60 → "--8"
    expect(b64urlEncode(new Uint8Array([0xfb, 0xef]))).toBe('--8');
    expect([...b64urlDecode('--8')]).toEqual([0xfb, 0xef]);
    expect(b64urlEncode(new Uint8Array([0x6b, 0x6f]))).toBe('a28');
  });
});

describe('decodeToken', () => {
  it('decodes the jwt.io example', () => {
    const d = decodeToken(JWT_IO_TOKEN);
    expect(d.header).toEqual(JWT_IO_HEADER);
    expect(d.payload).toEqual(JWT_IO_PAYLOAD);
    expect(d.warnings).toEqual([]);
    expect(d.signatureB64).toBe('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
  });

  it('rejects malformed tokens', () => {
    expect(() => decodeToken('onlyonepart')).toThrow(/2 or 3/);
    expect(() => decodeToken('!!!.@@@.###')).toThrow(/base64url/);
  });
});

describe('secretBytes', () => {
  it('prefers base64 when it looks like base64', () => {
    const s = 'c2VjcmV0'; // "secret"
    expect(secretBytes(s, true).mode).toBe('base64');
    expect(secretBytes(s, true).bytes).toEqual(new TextEncoder().encode('secret'));
  });

  it('falls back to text otherwise', () => {
    expect(secretBytes('my plain secret', false).mode).toBe('text');
    // Short strings are not treated as base64.
    expect(secretBytes('abc', true).mode).toBe('text');
  });
});

describe('HS256 sign/verify', () => {
  /** Independent HMAC-SHA256 over the same segments (node:crypto). */
  const nodeHmacSig = () =>
    createHmac('sha256', JWT_IO_SECRET)
      .update(
        `${b64urlEncodeText(JSON.stringify(JWT_IO_HEADER))}.${b64urlEncodeText(JSON.stringify(JWT_IO_PAYLOAD))}`,
      )
      .digest('base64url');

  it('matches an independent HMAC implementation (node:crypto)', async () => {
    const { token } = await signToken(JWT_IO_HEADER, JWT_IO_PAYLOAD, {
      alg: 'HS256',
      secret: JWT_IO_SECRET,
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(token.split('.')[2]).toBe(nodeHmacSig());
  });

  it('verifies a valid token and rejects a wrong secret', async () => {
    const { token } = await signToken(JWT_IO_HEADER, JWT_IO_PAYLOAD, {
      alg: 'HS256',
      secret: JWT_IO_SECRET,
    });
    const ok = await verifyToken(token, { secret: JWT_IO_SECRET });
    expect(ok.valid).toBe(true);
    const bad = await verifyToken(token, { secret: 'wrong' });
    expect(bad.valid).toBe(false);
    expect(bad.reason).toMatch(/mismatch/i);
  });

  it('refuses unsigned "none" tokens', async () => {
    const h = b64urlEncodeText(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const p = b64urlEncodeText(JSON.stringify(JWT_IO_PAYLOAD));
    const none = await verifyToken(`${h}.${p}.`, { secret: 'x'.repeat(32) });
    expect(none.valid).toBe(false);
  });
});

describe('ES256 round-trip (WebCrypto)', () => {
  it('signs with PKCS#8 and verifies with SPKI', async () => {
    const subtleApi = globalThis.crypto.subtle;
    const kp = (await subtleApi.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;

    const privDer: ArrayBuffer = await subtleApi.exportKey('pkcs8', kp.privateKey);
    const pubSpki: ArrayBuffer = await subtleApi.exportKey('spki', kp.publicKey);
    const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
    const privPem = `-----BEGIN PRIVATE KEY-----\n${b64(privDer)
      .match(/.{1,64}/g)!
      .join('\n')}\n-----END PRIVATE KEY-----`;
    const pubPem = `-----BEGIN PUBLIC KEY-----\n${b64(pubSpki)
      .match(/.{1,64}/g)!
      .join('\n')}\n-----END PUBLIC KEY-----`;

    const header = { alg: 'ES256', typ: 'JWT' };
    const payload = { sub: '1', iat: 1516239022 };
    const { token } = await signToken(header, payload, { alg: 'ES256', privateKey: privPem });
    expect(token.split('.')).toHaveLength(3);

    const ok = await verifyToken(token, { publicKey: pubPem });
    expect(ok.valid).toBe(true);

    // Tampered payload must fail.
    const parts = token.split('.');
    const tampered = `${parts[0]}.${b64urlEncodeText(JSON.stringify({ sub: '2', iat: 1516239022 }))}.${parts[2]}`;
    const bad = await verifyToken(tampered, { publicKey: pubPem });
    expect(bad.valid).toBe(false);
  });
});

describe('RS256 round-trip (WebCrypto)', () => {
  it('signs with PKCS#8 and verifies with SPKI', async () => {
    const subtleApi = globalThis.crypto.subtle;
    const kp = (await subtleApi.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;

    const privDer: ArrayBuffer = await subtleApi.exportKey('pkcs8', kp.privateKey);
    const pubSpki: ArrayBuffer = await subtleApi.exportKey('spki', kp.publicKey);
    const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
    const pem = (body: string) =>
      `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----`;

    const { token } = await signToken(
      { alg: 'RS256', typ: 'JWT' },
      { sub: '1' },
      { alg: 'RS256', privateKey: pem(b64(privDer)) },
    );
    const ok = await verifyToken(token, {
      publicKey: pem(b64(pubSpki)).replace('PRIVATE', 'PUBLIC'),
    });
    expect(ok.valid).toBe(true);
  }, 20000);
});

describe('ECDSA DER ⇄ raw', () => {
  it('round-trips a 32-byte r||s (P-256)', () => {
    const raw = new Uint8Array(64);
    for (let i = 0; i < 64; i += 1) raw[i] = (i * 13 + 3) & 0xff;
    const der = rawToDerEcdsa(raw);
    const back = derToRawEcdsa(der);
    expect(Array.from(back)).toEqual(Array.from(raw));
  });

  it('handles leading-zero integers', () => {
    // Force a leading zero: r starts with a small byte, s starts with 0x80+.
    const raw = new Uint8Array(64);
    raw[0] = 0x01; // r
    raw[32] = 0xff; // s — top bit set → DER needs a 0x00 pad byte
    const der = rawToDerEcdsa(raw);
    expect(derToRawEcdsa(der)).toEqual(raw);
  });
});

describe('claimStatuses', () => {
  const now = 1_700_000_000;
  it('flags expired / not-yet-valid tokens', () => {
    const statuses = claimStatuses({ exp: now - 10, nbf: now + 10, iat: now - 100 }, now);
    const exp = statuses.find((s) => s.claim === 'exp')!;
    const nbf = statuses.find((s) => s.claim === 'nbf')!;
    expect(exp.ok).toBe(false);
    expect(nbf.ok).toBe(false);
  });

  it('accepts a healthy token', () => {
    const statuses = claimStatuses({ exp: now + 3600, iat: now - 10 }, now);
    expect(statuses.every((s) => s.ok)).toBe(true);
  });
});
