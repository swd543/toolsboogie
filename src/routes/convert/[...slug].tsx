/**
 * Per-path converter URLs: /convert/json-to-yaml, /convert/xml-to-ini, …
 *
 * Each of the 20 paths is its own indexable page - the converter loads with
 * that pair preset and the page carries its own title, description,
 * canonical and JSON-LD so a search for "xml to ini" lands here.
 */
import { RouteMeta } from '~/components/RouteMeta';
import { ConverterPage } from '~/features/convert/ConverterPage';
import { formatById, parseSlug } from '~/features/convert/logic';
import type { DataFormat } from '~/lib/wasm';

export default function ConvertPathPage(props: { params?: { slug?: string | string[] } }) {
  // Rest params may arrive under `params.slug` (string or array).
  const raw = props.params?.slug;
  const slug = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
  const pair = parseSlug(slug);
  if (!pair) {
    return (
      <div class="tool-page">
        <div class="tool-intro">
          <h1>Unknown conversion</h1>
          <p class="lede">
            That is not one of the converter paths. The data converter handles JSON, YAML, TOML, INI
            and XML - pick a pair there.
          </p>
        </div>
        <a class="btn btn-primary" href="/convert/">
          Open the data converter
        </a>
      </div>
    );
  }
  return (
    <>
      <RouteMeta path={`/convert/${pair.slug}`} />
      <ConverterPage
        title={`${formatById(pair.from)!.name} to ${formatById(pair.to)!.name}`}
        from={pair.from as DataFormat}
        to={pair.to as DataFormat}
      />
    </>
  );
}
