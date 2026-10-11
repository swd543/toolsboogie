/**
 * Retired: JSON formatting now lives inside the data converter
 * (JSON → JSON with indent, minify and sort keys).
 */
import { RedirectStub } from '~/components/RedirectStub';

export default function JsonFormatPage() {
  return (
    <RedirectStub
      to="/convert/"
      label="the data converter"
      title="JSON Formatter - now in the Data Converter | ToolsBoogie"
    />
  );
}
