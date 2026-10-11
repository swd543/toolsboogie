/**
 * Data validator (main page): JSON / YAML / TOML / INI / XML validity
 * checks with a format selector. The five per-format URLs live in
 * /<format>-validator.tsx - the same pattern as /convert and its paths.
 */
import { RouteMeta } from '~/components/RouteMeta';
import { ValidatorPage } from '~/features/validate/ValidatorPage';

export default function ValidatorsPage() {
  return (
    <>
      <RouteMeta path="/validators" />
      <ValidatorPage format="json" />
    </>
  );
}
