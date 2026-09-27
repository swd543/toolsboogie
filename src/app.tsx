/**
 * App root: metadata provider, router, and the page shell around the
 * file-based routes.
 *
 * SolidStart v2 pattern: `FileRoutes` is the route table, so it goes
 * *inside* an explicit `<Router>`; the page shell is passed as the
 * router's `root` so it wraps the matched route while staying inside the
 * router context (it uses `useLocation` for nav highlighting).
 *
 * Design system styles are imported here so they end up in the client
 * bundle (extracted to hashed CSS assets in production).
 *
 * Every tool route is lazy: file-based routes are code-split, so opening
 * the guitar tuner only fetches the tuner chunk (+ the WASM core on first
 * use) — never the rest of the suite.
 */
import '~/styles/tokens.css';
import '~/styles/base.css';
import '~/styles/components.css';
import { MetaProvider } from '@solidjs/meta';
import { Router } from '@solidjs/router';
import { FileRoutes } from '@solidjs/start/router';
import { Shell } from '~/components/Shell';

export default function App() {
  return (
    <MetaProvider>
      <Router root={Shell}>
        <FileRoutes />
      </Router>
    </MetaProvider>
  );
}
