/**
 * Client entry: hydrates the prerendered HTML (production) or renders
 * fresh (development).
 */
import { mount, StartClient } from '@solidjs/start/client';
import { render } from 'solid-js/web';

const root = document.getElementById('app');
if (!root) throw new Error('Root element #app not found');

if (import.meta.env.DEV) {
  render(() => <StartClient />, root);
} else {
  mount(() => <StartClient />, root);
}
