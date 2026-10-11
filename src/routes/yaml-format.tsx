/**
 * Retired: YAML formatting/validation now lives inside the data converter
 * (YAML → YAML, or YAML → any of the other four formats).
 */
import { RedirectStub } from '~/components/RedirectStub';

export default function YamlFormatPage() {
  return (
    <RedirectStub
      to="/convert/"
      label="the data converter"
      title="YAML Formatter - now in the Data Converter | ToolsBoogie"
    />
  );
}
