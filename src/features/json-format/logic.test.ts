/**
 * JSON format logic tests. In Node the WASM core is absent, so these
 * exercise the JS fallback path (CapabilityError → JSON.parse/stringify).
 */
import { describe, expect, it } from 'vitest';
import { formatJson, validateJson } from './logic';

describe('formatJson (JS fallback path in Node)', () => {
  it('pretty-prints', async () => {
    const r = await formatJson('{"b":1,"a":2}', { indent: 2, sortKeys: false });
    expect(r.via).toBe('js');
    expect(r.output).toBe('{\n  "b": 1,\n  "a": 2\n}');
  });

  it('minifies', async () => {
    const r = await formatJson('{"a" : [ 1 , 2 ]}', { indent: 0, sortKeys: false });
    expect(r.output).toBe('{"a":[1,2]}');
  });

  it('sorts keys when asked', async () => {
    const r = await formatJson('{"b":1,"a":{"y":1,"x":2}}', { indent: 2, sortKeys: true });
    expect(r.output).toBe('{\n  "a": {\n    "x": 2,\n    "y": 1\n  },\n  "b": 1\n}');
  });

  it('throws positioned errors on bad input', async () => {
    await expect(formatJson('{bad', { indent: 2, sortKeys: false })).rejects.toThrow();
  });
});

describe('validateJson', () => {
  it('accepts valid JSON', async () => {
    expect((await validateJson('{"a": [1, 2.5, null, "x"]}')).error).toBeNull();
  });

  it('reports invalid JSON', async () => {
    const r = await validateJson('{"a": }');
    expect(r.error).toBeTruthy();
  });
});
