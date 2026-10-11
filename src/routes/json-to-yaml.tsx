/**
 * Retired: replaced by the dedicated per-path converter page
 * /convert/json-to-yaml (same tool, its own indexable URL).
 */
import { RedirectStub } from '~/components/RedirectStub';

export default function JsonToYamlPage() {
  return (
    <RedirectStub
      to="/convert/json-to-yaml/"
      label="the JSON to YAML converter"
      title="JSON to YAML Converter | ToolsBoogie"
    />
  );
}
