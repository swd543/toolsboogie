/**
 * XML validator: check XML without converting (see features/validate).
 */
import { RouteMeta } from '~/components/RouteMeta';
import { ValidatorPage } from '~/features/validate/ValidatorPage';

export default function XMLValidatorPage() {
  return (
    <>
      <RouteMeta path="/xml-validator" />
      <ValidatorPage format="xml" fixed />
    </>
  );
}
