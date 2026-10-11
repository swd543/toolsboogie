/**
 * Data converter logic: the pure parts (slugs, pairs, format registry).
 * The WASM conversion itself is covered by the cargo tests in wasm/toolcore.
 */
import { describe, expect, it } from 'vitest';
import {
  FORMATS,
  formatById,
  formatPairs,
  parseSlug,
  pathMeta,
  SAMPLE_INPUT,
  SAMPLES,
  sampleFor,
  slugFor,
} from './logic';

describe('format registry', () => {
  it('has exactly the five supported formats', () => {
    expect(FORMATS.map((f) => f.id)).toEqual(['json', 'yaml', 'toml', 'ini', 'xml']);
  });

  it('every format has a label, extension, mime and note', () => {
    for (const f of FORMATS) {
      expect(f.label).toBeTruthy();
      expect(f.ext).toBeTruthy();
      expect(f.mime).toBeTruthy();
      expect(f.note).toBeTruthy();
      expect(f.name).toBeTruthy();
    }
  });

  it('looks formats up by id', () => {
    expect(formatById('yaml')?.label).toBe('YAML');
    expect(formatById('nope')).toBeUndefined();
  });
});

describe('conversion paths', () => {
  it('builds all 20 directed pairs', () => {
    const pairs = formatPairs();
    expect(pairs).toHaveLength(20);
    const slugs = new Set(pairs.map((p) => p.slug));
    expect(slugs).toHaveLength(20);
    expect(pairs.some((p) => p.slug === 'json-to-yaml')).toBe(true);
    expect(pairs.some((p) => p.from === p.to)).toBe(false);
  });

  it('parses valid slugs', () => {
    expect(parseSlug('xml-to-ini')).toEqual({ from: 'xml', to: 'ini', slug: 'xml-to-ini' });
    expect(parseSlug(slugFor('json', 'yaml'))).not.toBeNull();
  });

  it('rejects invalid slugs', () => {
    expect(parseSlug('')).toBeNull();
    expect(parseSlug('json')).toBeNull();
    expect(parseSlug('json-to-nope')).toBeNull();
    expect(parseSlug('json-to-json')).toBeNull(); // same format is not a path
    expect(parseSlug('JSON-to-yaml')).toBeNull(); // case-sensitive ids
  });

  it('per-path SEO text names both formats', () => {
    const meta = pathMeta({ from: 'json', to: 'yaml', slug: 'json-to-yaml' });
    expect(meta.title).toContain('JSON to YAML');
    expect(meta.description).toContain('JSON');
    expect(meta.description).toContain('yaml');
  });
});

describe('sample input', () => {
  it('is valid JSON without arrays or nulls (converts to every format)', () => {
    const v = JSON.parse(SAMPLE_INPUT);
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) throw new Error('sample must not contain arrays');
      if (x === null) throw new Error('sample must not contain nulls');
      if (x && typeof x === 'object') {
        for (const item of Object.values(x)) walk(item);
      }
    };
    walk(v);
  });
});

describe('per-format samples', () => {
  it('has a non-empty sample for every format', () => {
    for (const f of FORMATS) {
      expect(SAMPLES[f.id].trim().length, `sample for ${f.id}`).toBeGreaterThan(10);
    }
  });

  it('sampleFor resolves auto to the JSON sample and pins named formats', () => {
    expect(sampleFor('auto')).toBe(SAMPLES.json);
    expect(sampleFor('auto')).toBe(SAMPLE_INPUT);
    expect(sampleFor('yaml')).toBe(SAMPLES.yaml);
    expect(sampleFor('xml')).toBe(SAMPLES.xml);
  });

  it('each sample is written in its own format', () => {
    expect(SAMPLES.json.trimStart().startsWith('{')).toBe(true);
    expect(SAMPLES.yaml).toContain('app: boogie');
    expect(SAMPLES.toml).toContain('app = "boogie"');
    expect(SAMPLES.ini).toContain('app=boogie');
    expect(SAMPLES.xml).toContain('<config>');
  });

  it('no sample contains arrays or nulls (INI/TOML/XML limits)', () => {
    for (const f of FORMATS) {
      const s = SAMPLES[f.id];
      // TOML tables and INI sections legitimately use [brackets]; the array
      // check applies to the formats where brackets mean arrays.
      if (f.id !== 'toml' && f.id !== 'ini') {
        expect(s, `${f.id} sample`).not.toMatch(/\[|\]/);
      }
      expect(s, `${f.id} sample`).not.toMatch(/null|~\b/);
    }
  });
});
