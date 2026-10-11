/**
 * INI validator: check INI without converting (see features/validate).
 */
import { RouteMeta } from '~/components/RouteMeta';
import { ValidatorPage } from '~/features/validate/ValidatorPage';

export default function INIValidatorPage() {
  return (
    <>
      <RouteMeta path="/ini-validator" />
      <ValidatorPage format="ini" />
    </>
  );
}
