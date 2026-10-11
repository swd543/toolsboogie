/**
 * Prerendered redirect stub for a retired route: a meta-refresh for
 * crawlers plus an immediate JS redirect for browsers, with the canonical
 * pointing at the replacement so the old URL keeps passing SEO value.
 */
import { Meta, Title } from '@solidjs/meta';
import { onMount } from 'solid-js';

export function RedirectStub(props: { to: string; label: string; title: string }) {
  onMount(() => {
    window.location.replace(props.to);
  });
  return (
    <main class="redirect-stub">
      <Title>{props.title}</Title>
      <Meta name="robots" content="noindex,follow" />
      <Meta http-equiv="refresh" content={`0;url=${props.to}`} />
      <h1>Moving to {props.label}…</h1>
      <p>
        This page has moved. You will be redirected automatically - or{' '}
        <a href={props.to}>go to {props.label}</a>.
      </p>
    </main>
  );
}
