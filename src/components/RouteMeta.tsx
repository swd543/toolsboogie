/**
 * Per-route SEO head block (title, meta description, Open Graph, JSON-LD).
 * Rendered by every route so the prerendered HTML carries the full document.
 */
import { Link, Meta, Title } from '@solidjs/meta';
import { canonicalFor, jsonLdFor, routeMeta } from '~/site/seo';

export function RouteMeta(props: { path: string }) {
  const meta = () => routeMeta[props.path] ?? routeMeta['/']!;
  const canonical = canonicalFor(props.path);
  return (
    <>
      <Title>{meta().title}</Title>
      <Meta name="description" content={meta().description} />
      <Link rel="canonical" href={canonical} />
      <Meta property="og:title" content={meta().title} />
      <Meta property="og:description" content={meta().description} />
      <Meta property="og:url" content={canonical} />
      {meta().image && <Meta property="og:image" content={meta().image} />}
      <script type="application/ld+json" innerHTML={JSON.stringify(jsonLdFor(props.path))} />
    </>
  );
}
