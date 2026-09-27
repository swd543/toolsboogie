/**
 * Privacy page — required for AdSense, and genuinely true here.
 */
import { RouteMeta } from '~/components/RouteMeta';
import { site, siteUrl } from '~/site/config';

export default function PrivacyPage() {
  return (
    <>
      <RouteMeta path="/privacy" />
      <div class="prose">
        <h1>Privacy</h1>
        <p>
          <b>{site.name}</b> is a set of tools that run entirely in your browser. Every computation
          - JSON and YAML processing, JWT signing and verification, pitch detection, string
          escaping, date conversion - happens on your device. Nothing you enter is transmitted to
          us, stored, or shared.
        </p>

        <h2>What is processed locally</h2>
        <ul>
          <li>
            <b>Files & text you paste</b> (JSON, YAML, tokens, strings, timestamps): parsed and
            transformed in-page by the site's JavaScript and its small Rust/WASM module. They are
            discarded when you close the tab.
          </li>
          <li>
            <b>Microphone audio</b> (guitar tuner): analyzed frame-by-frame for pitch and
            immediately discarded. It is never recorded or uploaded, and the analysis path is silent
            (nothing is played back).
          </li>
          <li>
            <b>Sensor data</b> (compass, level): orientation and motion readings are used only to
            draw the dial and bubble on screen.
          </li>
          <li>
            <b>Keys & secrets</b> (JWT): signing and verification run via your browser's WebCrypto.
            Keys never leave the page and are not stored.
          </li>
        </ul>

        <h2>What your browser may store</h2>
        <ul>
          <li>
            The ruler calibration (screen size) is stored in <code>localStorage</code> on this
            device only, so it survives a reload. You can reset it on the ruler page or clear site
            data in your browser.
          </li>
        </ul>

        <h2>What we do not do</h2>
        <ul>
          <li>No accounts, no login, no email collection.</li>
          <li>No server-side processing of your content - the site is fully static.</li>
          <li>No tracking of your use of the tools.</li>
        </ul>

        <h2>Advertising & analytics</h2>
        <p>
          This site may display advertisements served by Google AdSense. If ads are shown, AdSense
          may use cookies to serve ads; you can opt out of personalised advertising in your Google
          settings. We do not place our own analytics or tracking scripts.
        </p>

        <h2>Contact</h2>
        <p>
          Questions or concerns about this privacy policy? Email{' '}
          <a href="mailto:{site.contactEmail}">{site.contactEmail}</a>.
        </p>

        <p class="prose-foot">Last updated: September 2026 · {siteUrl}</p>
      </div>
    </>
  );
}
