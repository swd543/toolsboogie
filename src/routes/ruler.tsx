/**
 * Retired: the on-screen ruler was removed from the site (its
 * motion-sensor slide measurement proved unreliable on real devices).
 */
import { RedirectStub } from '~/components/RedirectStub';

export default function RulerPage() {
  return (
    <RedirectStub to="/" label="the home page" title="Online Ruler - Tool Removed | ToolsBoogie" />
  );
}
