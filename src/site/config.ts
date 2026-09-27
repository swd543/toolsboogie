/**
 * Central site configuration.
 *
 * Everything brand- or environment-related lives here so the rest of the
 * codebase stays free of magic strings. To rename the project, change
 * `name`/`tagline` below.
 */

export interface Donation {
  id: string;
  label: string;
  address: string;
  /** URI scheme for a tap-to-pay link (e.g. `bitcoin:`); empty = plain text. */
  scheme: string;
  /** Optional payment memo / destination tag (XRP). */
  memo?: string;
}

export const site = {
  name: 'ToolsBoogie',
  tagline: 'Tools that boogie - right in your browser.',
  description:
    'Free, secure and private browser tools: guitar tuner, JSON/YAML formatter and converter, regex checker, ' +
    'string escaper, date/time converter, JWT decoder, compass, level and on-screen ruler. 100% client-side - ' +
    'everything runs on your device and nothing is ever uploaded.',
  /** Default origin used when VITE_SITE_URL is not set (dev). */
  fallbackUrl: 'http://localhost:3000',
  /** Contact shown on the privacy page (AdSense requires a contact path). */
  contactEmail: 'swd543@gmail.com',
  /** Public source repository (footer link). */
  github: 'https://github.com/swd543/toolsboogie',
  /** AdSense publisher id; empty string = ad-free build. */
  adsenseClient: (import.meta.env.VITE_ADSENSE_CLIENT as string | undefined) ?? '',
  /**
   * Direct donations (no third-party middleman). The site is free and the
   * processing happens in the visitor's browser, but hosting and
   * maintenance cost something — these are the only payment surfaces.
   */
  donation: [
    {
      id: 'btc',
      label: 'BTC',
      address: '1EEkZa2xwRDGfLSLBhLtU2MZKph2MYeHXb',
      scheme: 'bitcoin',
    },
    {
      id: 'eth',
      label: 'ETH',
      address: '0xb4ab64e921ad16de8aa703d824cb1f69c6d9cb8c',
      scheme: 'ethereum',
    },
    {
      id: 'xrp',
      label: 'XRP',
      address: 'r9nhTUa3gsa9LEd94adCzEjezWVxKCCRe4',
      /** XRP payments should include this destination tag/memo. */
      memo: '502538661',
      scheme: '',
    },
  ] as Donation[],
} as const;

export const siteUrl = (import.meta.env.VITE_SITE_URL as string | undefined) ?? site.fallbackUrl;

/** Tool registry — drives the home page, nav, footer and sitemap. */
export interface ToolDef {
  /** Route path, e.g. "/guitar-tuner". */
  path: string;
  /** Short label for nav/footer. */
  label: string;
  /** One-line description shown on cards. */
  blurb: string;
  icon:
    | 'tuner'
    | 'braces'
    | 'swap'
    | 'yaml'
    | 'regex'
    | 'escape'
    | 'time'
    | 'cron'
    | 'key'
    | 'compass'
    | 'ruler'
    | 'level';
}

export const tools: ToolDef[] = [
  {
    path: '/guitar-tuner',
    label: 'Guitar tuner',
    blurb: 'Tune by ear or by eye - live pitch from your microphone, on device.',
    icon: 'tuner',
  },
  {
    path: '/json-format',
    label: 'JSON format',
    blurb: 'Pretty-print, minify and validate JSON with exact error positions.',
    icon: 'braces',
  },
  {
    path: '/json-to-yaml',
    label: 'JSON → YAML',
    blurb: 'Convert JSON to clean YAML - no round-tripping through a server.',
    icon: 'swap',
  },
  {
    path: '/yaml-format',
    label: 'YAML format',
    blurb: 'Validate and re-format YAML, or convert it back to JSON.',
    icon: 'yaml',
  },
  {
    path: '/regex',
    label: 'Regex',
    blurb: 'Check and build regular expressions - linted for the engine you target.',
    icon: 'regex',
  },
  {
    path: '/string-escape',
    label: 'String escape',
    blurb: 'Escape/unescape strings for JSON, JS, C, HTML, shell, URLs and more.',
    icon: 'escape',
  },
  {
    path: '/time',
    label: 'Date & time',
    blurb: 'Convert timestamps: ISO, epoch, FILETIME, .NET ticks, Python, SQL - any timezone.',
    icon: 'time',
  },
  {
    path: '/cron',
    label: 'Cron',
    blurb:
      'Explain cron schedules in plain English and build them back - next fire times included.',
    icon: 'cron',
  },
  {
    path: '/jwt',
    label: 'JWT',
    blurb: 'Decode, inspect, edit and re-sign JSON Web Tokens - HS/RS/ES, locally.',
    icon: 'key',
  },
  {
    path: '/compass',
    label: 'Compass',
    blurb: 'A true-heading compass from your device sensors, rendered in real time.',
    icon: 'compass',
  },
  {
    path: '/ruler',
    label: 'Ruler',
    blurb:
      'A dual-edge on-screen ruler - metric left, imperial right - that calibrates itself from your screen.',
    icon: 'ruler',
  },
  {
    path: '/level',
    label: 'Level',
    blurb: 'Bubble-level from the accelerometer with degree precision.',
    icon: 'level',
  },
];

/** Extra (non-tool) routes, in nav order. */
export const staticPages = [{ path: '/privacy', label: 'Privacy' }] as const;
