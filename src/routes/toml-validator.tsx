/**
 * TOML validator: check TOML without converting (see features/validate).
 */
import { RouteMeta } from '~/components/RouteMeta';
import { ValidatorPage } from '~/features/validate/ValidatorPage';

export default function TOMLValidatorPage() {
  return (
    <>
      <RouteMeta path="/toml-validator" />
      <ValidatorPage format="toml" fixed />
    </>
  );
}
