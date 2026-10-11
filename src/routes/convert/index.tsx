/**
 * Data converter (main page): JSON / YAML / TOML / INI / XML to each other.
 * The 20 per-path URLs live in ./convert/[...slug].tsx.
 */
import { RouteMeta } from '~/components/RouteMeta';
import { ConverterPage } from '~/features/convert/ConverterPage';

export default function ConvertPage() {
  return (
    <>
      <RouteMeta path="/convert" />
      <ConverterPage title="Data converter" from="auto" to="json" />
    </>
  );
}
