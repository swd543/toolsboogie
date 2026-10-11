/**
 * Per-path converter URLs: /convert/json-to-yaml, /convert/xml-to-ini, …
 *
 * Each of the 20 paths is its own indexable page - the converter loads with
 * that pair preset and the page carries its own title, description,
 * canonical and JSON-LD so a search for "xml to ini" lands here.
 */

import { useLocation } from '@solidjs/router';
import { Show } from 'solid-js';
import { RouteMeta } from '~/components/RouteMeta';
import { ConverterPage } from '~/features/convert/ConverterPage';
import { formatById, parseSlug } from '~/features/convert/logic';
import type { DataFormat } from '~/lib/wasm';

function UnknownConversion() {
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

export default function ConvertPathPage() {
  // Derive the pair from the live location signal: same-route param changes
  // (clicking another path link) must re-render this page with the new
  // preset - the route props themselves are not reactive to them.
  const location = useLocation();
  const pair = () => {
    const m =
      /^\/convert\/([a-z]+-to-[a-z]+)\/$/.exec(location.pathname) ??
      /^\/convert\/([a-z]+-to-[a-z]+)$/.exec(location.pathname);
    return m ? parseSlug(m[1] ?? '') : null;
  };

  return (
    <Show when={pair()} fallback={<UnknownConversion />}>
      {(p) => (
        <>
          <RouteMeta path={`/convert/${p().slug}`} />
          <ConverterPage
            title={`${formatById(p().from)!.name} to ${formatById(p().to)!.name}`}
            from={p().from as DataFormat}
            to={p().to as DataFormat}
          />
        </>
      )}
    </Show>
  );
}
