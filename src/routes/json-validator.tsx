/**
 * JSON validator: check JSON without converting (see features/validate).
 */
import { RouteMeta } from '~/components/RouteMeta';
import { ValidatorPage } from '~/features/validate/ValidatorPage';

export default function JSONValidatorPage() {
  return (
    <>
      <RouteMeta path="/json-validator" />
      <ValidatorPage format="json" fixed />
    </>
  );
}
