/**
 * 404 — unknown route.
 */
import { Meta, Title } from '@solidjs/meta';
import { site } from '~/site/config';

export default function NotFound() {
  return (
    <>
      <Title>Not found | {site.name}</Title>
      <Meta name="robots" content="noindex" />
      <div class="prose" style="text-align: center; padding: 3rem 0">
        <h1>404</h1>
        <p>This page boogied away. The tool you're after is probably on the home page.</p>
        <p>
          <a class="btn btn-primary" href="/">
            Back to all tools
          </a>
        </p>
      </div>
    </>
  );
}
