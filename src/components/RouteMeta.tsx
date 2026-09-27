/**
 * Per-route SEO head block (title, meta description, Open Graph, JSON-LD).
 * Rendered by every route so the prerendered HTML carries the full document.
 */
import { Meta, Title } from '@solidjs/meta';
import { siteUrl } from '~/site/config';
import { jsonLdFor, routeMeta } from '~/site/seo';

export function RouteMeta(props: { path: string }) {
  const meta = () => routeMeta[props.path] ?? routeMeta['/']!;
  return (
    <>
      <Title>{meta().title}</Title>
      <Meta name="description" content={meta().description} />
      <Meta property="og:title" content={meta().title} />
      <Meta property="og:description" content={meta().description} />
      <Meta property="og:url" content={`${siteUrl}${props.path}`} />
      {meta().image && <Meta property="og:image" content={meta().image} />}
      <script type="application/ld+json" innerHTML={JSON.stringify(jsonLdFor(props.path))} />
    </>
  );
}
