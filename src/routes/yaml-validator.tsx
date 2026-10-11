/**
 * YAML validator: check YAML without converting (see features/validate).
 */
import { RouteMeta } from '~/components/RouteMeta';
import { ValidatorPage } from '~/features/validate/ValidatorPage';

export default function YAMLValidatorPage() {
  return (
    <>
      <RouteMeta path="/yaml-validator" />
      <ValidatorPage format="yaml" fixed />
    </>
  );
}
