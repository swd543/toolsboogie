import { describe, expect, it } from 'vitest';
import {
  availableTimezones,
  formatInstant,
  guessEpochUnit,
  humanReadable,
  nowParts,
  parseInstant,
  TimeParseError,
} from './logic';

const T = '2020-01-01T00:00:00Z';

describe('parseInstant', () => {
  it('parses ISO 8601', () => {
    const p = parseInstant(T, 'auto');
    expect(p.ms).toBe(1577836800000);
    expect(p.used).toBe('iso');
  });

  it('parses RFC 2822', () => {
    const p = parseInstant('Wed, 01 Jan 2020 00:00:00 GMT', 'auto');
    expect(p.ms).toBe(1577836800000);
    expect(p.used).toBe('rfc2822');
  });

  it('parses SQL datetime as UTC', () => {
    const p = parseInstant('2020-01-01 00:00:00', 'sql');
    expect(p.ms).toBe(1577836800000);
  });

  it('parses epochs by digit count (auto)', () => {
    expect(parseInstant('1577836800', 'auto').used).toBe('epoch-s');
    expect(parseInstant('1577836800000', 'auto').used).toBe('epoch-ms');
    expect(parseInstant('1577836800000000', 'auto').used).toBe('epoch-us');
    const ns = parseInstant('1577836800000000000', 'auto');
    expect(ns.used).toBe('epoch-ns');
    expect(ns.ms).toBe(1577836800000);
  });

  it('keeps sub-millisecond precision for µs', () => {
    // 1577836800.123456 s → ms = …800123, remainder 456 µs = 456000 ns
    const p = parseInstant('1577836800123456', 'epoch-us');
    expect(p.ms).toBe(1577836800123);
    expect(p.subMs).toBe(456000);
  });

  it('parses Windows FILETIME', () => {
    // 2020-01-01T00:00:00Z in FILETIME: (ms + 11644473600000) * 10000
    const ft = String(BigInt(1577836800000 + 11644473600000) * 10000n);
    const p = parseInstant(ft, 'filetime');
    expect(p.ms).toBe(1577836800000);
  });

  it('parses .NET ticks', () => {
    const ticks = String(BigInt(1577836800000 + 62135596800000) * 10000n);
    const p = parseInstant(ticks, 'net-ticks');
    expect(p.ms).toBe(1577836800000);
  });

  it('parses C locale output', () => {
    const p = parseInstant('Wed Jan  1 00:00:00 UTC 2020', 'c-locale');
    expect(p.ms).toBe(1577836800000);
  });

  it('rejects garbage', () => {
    expect(() => parseInstant('not a date', 'iso')).toThrow(TimeParseError);
    expect(() => parseInstant('', 'auto')).toThrow(TimeParseError);
  });
});

describe('guessEpochUnit', () => {
  it('buckets by digit count', () => {
    expect(guessEpochUnit(10)).toBe('s');
    expect(guessEpochUnit(11)).toBe('ms');
    expect(guessEpochUnit(13)).toBe('ms');
    expect(guessEpochUnit(16)).toBe('us');
    expect(guessEpochUnit(19)).toBe('ns');
  });
});

describe('formatInstant', () => {
  const p = parseInstant(T, 'iso');
  const f = formatInstant(p);

  it('formats the canonical instant', () => {
    expect(f.isoUtc).toBe('2020-01-01T00:00:00.000Z');
    expect(f.epochS).toBe('1577836800');
    expect(f.epochMs).toBe('1577836800000');
    expect(f.epochUs).toBe('1577836800000000');
    expect(f.epochNs).toBe('1577836800000000000');
    expect(f.rfc2822).toBe('Wed, 01 Jan 2020 00:00:00 +0000');
    expect(f.sqlUtc).toBe('2020-01-01 00:00:00');
    expect(f.linuxDateOut).toBe('Wed Jan 01 00:00:00 UTC 2020');
    expect(f.linuxDateCmd).toBe('date -u -d @1577836800');
    expect(f.pythonIso).toBe('2020-01-01T00:00:00.000+00:00');
    expect(f.goLiteral).toBe('time.Unix(1577836800, 0).UTC()');
    expect(f.filetime).toBe(String(BigInt(1577836800000 + 11644473600000) * 10000n));
  });

  it('human-readable respects the timezone', () => {
    expect(f.human('UTC')).toContain('Wed, 01 Jan 2020 00:00:00');
    // 2020-01-01 00:00 UTC is still Tue evening in New York (EST, −5h).
    expect(f.human('America/New_York')).toContain('Tue, 31 Dec 2019 19:00:00');
    expect(f.human('Asia/Tokyo')).toContain('Wed, 01 Jan 2020 09:00:00');
  });

  it('humanReadable handles midnight (24 → 00)', () => {
    expect(humanReadable(1577836800000, 'UTC')).toContain('00:00:00');
  });
});

describe('nowParts / availableTimezones', () => {
  it('nowParts is consistent', () => {
    const n = nowParts();
    expect(Number(n.epochS)).toBe(Math.floor(n.ms / 1000));
    expect(n.epochMs).toBe(String(n.ms));
  });

  it('lists common timezones', () => {
    const tzs = availableTimezones();
    expect(tzs).toContain('UTC');
    expect(tzs).toContain('Europe/Berlin');
    expect(tzs.length).toBeGreaterThanOrEqual(30);
  });
});
